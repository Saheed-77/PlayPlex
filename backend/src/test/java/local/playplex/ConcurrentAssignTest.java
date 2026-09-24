package local.playplex;

import local.playplex.api.dto.SessionDtos.StartSessionRequest;
import local.playplex.api.dto.TicketDtos.CreateTicketRequest;
import local.playplex.api.dto.TicketDtos.PaymentInput;
import local.playplex.api.dto.TicketDtos.StudentInput;
import local.playplex.api.dto.TicketDtos.TicketDto;
import local.playplex.domain.Device;
import local.playplex.domain.PaymentMethod;
import local.playplex.domain.Role;
import local.playplex.domain.SkipReason;
import local.playplex.error.ApiException;
import local.playplex.error.ErrorCode;
import local.playplex.repo.DeviceRepository;
import local.playplex.repo.PlaySessionRepository;
import local.playplex.security.CurrentUser;
import local.playplex.service.SessionService;
import local.playplex.service.TicketService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The highest-value test in the suite (docs/06 §8): ten volunteers tap the same free
 * station at the same instant, and exactly one wins.
 *
 * To prove it is the database protecting you and not luck, drop
 * `ux_active_session_per_device` and watch this test fail (docs/07 task 1.7).
 */
class ConcurrentAssignTest extends IntegrationTestBase {

    @Autowired TicketService tickets;
    @Autowired SessionService sessions;
    @Autowired DeviceRepository devices;
    @Autowired PlaySessionRepository playSessions;

    private static final CurrentUser ADMIN = new CurrentUser(1L, "admin", Role.ADMIN);

    @Test
    void tenVolunteersOneDevice_exactlyOneWins() throws Exception {
        int attempts = 10;
        Device device = devices.findByCode("LAP-04").orElseThrow();

        // One ticket per thread, so the only thing they contend over is the device.
        List<Long> ticketIds = new ArrayList<>();
        for (int i = 0; i < attempts; i++) {
            TicketDto ticket = tickets.create(new CreateTicketRequest(
                    new StudentInput("Racer " + i, "98765000" + String.format("%02d", i), null, null, null),
                    null, 1L, device.getDeviceType().getId(),
                    new PaymentInput(PaymentMethod.CASH, 3000, null, null), null), ADMIN);
            ticketIds.add(ticket.id());
        }

        AtomicInteger created = new AtomicInteger();
        AtomicInteger conflicts = new AtomicInteger();
        AtomicInteger other = new AtomicInteger();
        CountDownLatch startLine = new CountDownLatch(1);

        // ExecutorService only became AutoCloseable in Java 19; this targets 17.
        ExecutorService pool = Executors.newFixedThreadPool(attempts);
        try {
            List<Future<?>> futures = new ArrayList<>();
            for (Long ticketId : ticketIds) {
                futures.add(pool.submit(() -> {
                    startLine.await();
                    try {
                        sessions.start(new StartSessionRequest(device.getId(), List.of(ticketId),
                                SkipReason.OTHER), ADMIN);
                        created.incrementAndGet();
                    } catch (ApiException ex) {
                        // Losing the race is a clean, explainable conflict...
                        if (ex.code() == ErrorCode.DEVICE_NOT_AVAILABLE) conflicts.incrementAndGet();
                        else other.incrementAndGet();
                    } catch (Exception ex) {
                        // ...and so is losing it to the unique index, which surfaces as a
                        // constraint violation rather than a second session.
                        conflicts.incrementAndGet();
                    }
                    return null;
                }));
            }
            startLine.countDown();
            for (Future<?> f : futures) f.get(60, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        assertThat(created.get()).as("exactly one assignment succeeds").isEqualTo(1);
        assertThat(conflicts.get()).as("the other nine are rejected").isEqualTo(attempts - 1);
        assertThat(other.get()).as("no unexpected failures").isZero();

        // The real assertion: the room only ever had one live session on that station.
        assertThat(playSessions.findActive().stream()
                .filter(s -> s.getDevice().getId().equals(device.getId()))
                .count()).isEqualTo(1);
    }
}

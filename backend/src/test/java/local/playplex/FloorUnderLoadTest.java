package local.playplex;

import local.playplex.api.dto.FloorDtos.DeviceDto;
import local.playplex.api.dto.FloorDtos.FloorDto;
import local.playplex.api.dto.FloorDtos.NextUpDto;
import local.playplex.api.dto.QueueDtos.QueueItemDto;
import local.playplex.api.dto.SessionDtos.SessionSummaryDto;
import local.playplex.api.dto.SessionDtos.StartSessionRequest;
import local.playplex.api.dto.TicketDtos.CreateTicketRequest;
import local.playplex.api.dto.TicketDtos.PaymentInput;
import local.playplex.api.dto.TicketDtos.StudentInput;
import local.playplex.api.dto.TicketDtos.TicketDto;
import local.playplex.domain.*;
import local.playplex.repo.DeviceRepository;
import local.playplex.repo.PlaySessionRepository;
import local.playplex.repo.TicketRepository;
import local.playplex.security.CurrentUser;
import local.playplex.service.FloorService;
import local.playplex.service.QueueService;
import local.playplex.service.ReceptionService;
import local.playplex.service.SessionService;
import local.playplex.service.TicketService;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The board at the end of the evening, not the start of it (docs/07 task 6.3).
 *
 * Everything else in this suite runs against a floor holding one or two sessions, where a
 * quadratic loop is indistinguishable from a fast one. A real event finishes with ~200
 * tickets sold and dozens of people still waiting, and {@link FloorService#build} walks the
 * whole queue on every single request from every open tablet — computing next-up and a wait
 * estimate per device type — several times a second.
 *
 * So this seeds a full evening through the real services, and then asks the two questions
 * that matter at that size: is it still quick, and is it still *right*. The second is the
 * one a load test usually forgets, and it is the one that would hurt: handing eight free
 * stations the same person is invisible with three people in the queue.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class FloorUnderLoadTest extends IntegrationTestBase {

    /** A full evening (docs/01: ~200 registrations is a good night). */
    private static final int TICKETS = 200;
    /** Turns played and finished before now. */
    private static final int COMPLETED_SESSIONS = 50;

    /**
     * Generous on purpose: this shares a container with the rest of the suite on whatever
     * laptop is running it. It is not a benchmark — it is a tripwire for someone making
     * this O(devices x queue) by accident, which at these numbers would be seconds, not
     * milliseconds.
     */
    private static final long BUDGET_MS = 500;

    @Autowired TicketService tickets;
    @Autowired SessionService sessions;
    @Autowired local.playplex.service.DeviceService deviceService;
    @Autowired ReceptionService reception;
    @Autowired FloorService floor;
    @Autowired QueueService queue;
    @Autowired DeviceRepository devices;
    @Autowired PlaySessionRepository sessionRepo;
    @Autowired TicketRepository ticketRepo;

    private static final CurrentUser ADMIN = new CurrentUser(1L, "admin", Role.ADMIN);

    private final List<Long> seededTicketIds = new ArrayList<>();
    private final List<Long> startedSessionIds = new ArrayList<>();
    private String flaggedTicketNo;
    private boolean seeded;

    @BeforeAll
    void seedAFullEvening() {
        if (seeded) return;
        List<Device> stations = devices.findAllActiveWithType();

        // 200 registrations, spread across the plans and the kinds of station people ask
        // for. Keeping them pooled by preferred type matters: a ticket waiting for a PS5
        // cannot be seated at a laptop, and the server rightly refuses to try.
        Map<Long, Deque<Long>> waitingByType = new HashMap<>();
        for (int i = 0; i < TICKETS; i++) {
            long planId = 1 + (i % 3);                       // Quick Play / Standard / Marathon
            long typeId = stations.get(i % stations.size()).getDeviceType().getId();
            int price = switch ((int) planId) { case 1 -> 3000; case 2 -> 5000; default -> 9000; };
            TicketDto ticket = tickets.create(new CreateTicketRequest(
                    new StudentInput("Load Tester " + i, phone(i), null, null, null),
                    null, planId, typeId,
                    new PaymentInput(i % 2 == 0 ? PaymentMethod.CASH : PaymentMethod.UPI, price,
                            i % 2 == 0 ? null : "UPI" + i, null),
                    null), ADMIN);
            waitingByType.computeIfAbsent(typeId, k -> new ArrayDeque<>()).add(ticket.id());
            seededTicketIds.add(ticket.id());
        }

        // 50 turns played and finished, recycling the stations the way an evening does.
        // This is what leaves real session and payment history behind for the queries to
        // wade through, rather than a queue hanging in a vacuum.
        int played = 0;
        boolean progressed = true;
        while (played < COMPLETED_SESSIONS && progressed) {
            progressed = false;
            for (Device station : stations) {
                if (played >= COMPLETED_SESSIONS) break;
                if (!isFree(station)) continue;
                Long ticketId = take(waitingByType, station);
                if (ticketId == null) continue;
                SessionSummaryDto started = sessions.start(new StartSessionRequest(
                        station.getId(), List.of(ticketId), SkipReason.OTHER), ADMIN);
                sessions.end(started.id(), EndReason.COMPLETED, null, ADMIN);
                // A finished turn leaves the station in CLEANING, not free — the same tap a
                // volunteer makes before the next person sits down.
                deviceService.markReady(station.getId(), ADMIN);
                played++;
                progressed = true;
            }
        }

        // Half the stations busy right now, so the board carries both kinds of card.
        int leftRunning = 0;
        for (Device station : stations) {
            if (leftRunning >= stations.size() / 2) break;
            if (!isFree(station)) continue;
            Long ticketId = take(waitingByType, station);
            if (ticketId == null) continue;
            startedSessionIds.add(sessions.start(new StartSessionRequest(station.getId(),
                    List.of(ticketId), SkipReason.OTHER), ADMIN).id());
            leftRunning++;
        }

        // Everyone else is still waiting, and one person is bumped to the front — the
        // ordering has to survive the crowd, not just be right when the queue is short.
        // Priority 2, because earlier tests in this shared database leave reissued turns
        // sitting at priority 1 and a tie would be settled by who queued first.
        List<QueueItemDto> waiting = queue.list(null, null, ADMIN).items();
        flaggedTicketNo = reception.setPriority(waiting.get(waiting.size() - 1).ticketId(),
                (short) 2, "Waited through a device fault", ADMIN).ticketNo();
        seeded = true;
    }

    /**
     * Put the room back. This class shares one database with every other class in the
     * suite, so leaving 200 people queued and half the stations busy is not a tidiness
     * problem — it is four other tests failing on stations that were free a moment ago.
     */
    @AfterAll
    void putTheRoomBack() {
        for (Long sessionId : startedSessionIds) {
            PlaySession session = sessionRepo.findById(sessionId).orElse(null);
            if (session == null || session.getEndedAt() != null) continue;
            sessions.end(sessionId, EndReason.ADMIN_OVERRIDE, "load test teardown", ADMIN);
            deviceService.markReady(session.getDevice().getId(), ADMIN);
        }

        // Straight through the repository: this is teardown, not a cancellation anyone is
        // owed a refund for, and 150 of them one service call at a time is a slow way to
        // reach the same row.
        List<Ticket> mine = new ArrayList<>();
        for (Ticket t : ticketRepo.findAllById(seededTicketIds)) {
            if (t.getStatus() != TicketStatus.QUEUED) continue;
            t.setStatus(TicketStatus.CANCELLED);
            t.setCancelledAt(java.time.Instant.now());
            mine.add(t);
        }
        ticketRepo.saveAll(mine);
    }

    @Test
    void theBoardStillAnswersQuicklyWithAnEveningBehindIt() {
        assertThat(queue.list(null, null, ADMIN).items())
                .as("the seed should leave a real crowd waiting, not a handful")
                .hasSizeGreaterThan(100);

        // Warm the caches and the query plans; the first call of anything on the JVM is a
        // measurement of the JIT, not of this code.
        floor.build(ADMIN);

        long slowest = 0;
        for (int i = 0; i < 5; i++) {
            long started = System.nanoTime();
            FloorDto board = floor.build(ADMIN);
            slowest = Math.max(slowest, (System.nanoTime() - started) / 1_000_000);
            assertThat(board.devices()).isNotEmpty();
        }

        assertThat(slowest)
                .as("GET /api/floor took %dms with %d tickets and %d sessions behind it "
                        + "(budget %dms) — every open tablet asks for this several times a second",
                        slowest, TICKETS, sessionRepo.count(), BUDGET_MS)
                .isLessThan(BUDGET_MS);
    }

    @Test
    void theQueueIsStillInTheRightOrderWithAHundredPeopleInIt() {
        List<QueueItemDto> waiting = queue.list(null, null, ADMIN).items();

        assertThat(waiting.get(0).ticketNo())
                .as("a priority bump has to beat everyone, however long the queue is")
                .isEqualTo(flaggedTicketNo);

        // Behind the bumped person it is plain FIFO, and stays that way for the whole list.
        List<QueueItemDto> rest = waiting.subList(1, waiting.size());
        assertThat(rest).isSortedAccordingTo((a, b) -> a.queuedAt().compareTo(b.queuedAt()));
        assertThat(waiting).extracting(QueueItemDto::position)
                .startsWith(1, 2, 3);
    }

    @Test
    void everyFreeStationIsOfferedADifferentPerson() {
        FloorDto board = floor.build(ADMIN);
        List<NextUpDto> offers = board.devices().stream()
                .filter(d -> d.status() == DeviceStatus.AVAILABLE)
                .map(DeviceDto::nextUp)
                .filter(java.util.Objects::nonNull)
                .toList();

        assertThat(offers).as("free stations should have someone to offer, with 100+ waiting")
                .isNotEmpty();
        // The bug this exists for: hand every free station the head of the queue and two
        // volunteers start the same person on two machines. Invisible with a queue of three.
        assertThat(offers).extracting(NextUpDto::ticketId).doesNotHaveDuplicates();
    }

    /**
     * Earlier classes in this suite leave sessions running and stations out of service.
     * The seed works around whatever it finds rather than assuming an empty room.
     */
    private boolean isFree(Device station) {
        return devices.findById(station.getId()).orElseThrow().getStatus() == DeviceStatus.AVAILABLE
                && sessionRepo.findActiveByDevice(station.getId()).isEmpty();
    }

    /** The next person waiting for this kind of station, or null if nobody is. */
    private static Long take(Map<Long, Deque<Long>> waitingByType, Device station) {
        Deque<Long> pool = waitingByType.get(station.getDeviceType().getId());
        return pool == null ? null : pool.poll();
    }

    /** 200 distinct, valid Indian mobile numbers that no other test in the suite uses. */
    private static String phone(int i) {
        return "63" + String.format("%08d", 10_000 + i);
    }
}

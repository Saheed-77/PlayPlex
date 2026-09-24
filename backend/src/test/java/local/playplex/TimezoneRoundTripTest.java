package local.playplex;

import local.playplex.api.dto.SessionDtos.SessionSummaryDto;
import local.playplex.api.dto.SessionDtos.StartSessionRequest;
import local.playplex.api.dto.TicketDtos.CreateTicketRequest;
import local.playplex.api.dto.TicketDtos.PaymentInput;
import local.playplex.api.dto.TicketDtos.StudentInput;
import local.playplex.api.dto.TicketDtos.TicketDto;
import local.playplex.domain.Device;
import local.playplex.domain.PaymentMethod;
import local.playplex.domain.PlaySession;
import local.playplex.domain.Role;
import local.playplex.repo.DeviceRepository;
import local.playplex.repo.PlaySessionRepository;
import local.playplex.security.CurrentUser;
import local.playplex.service.SessionService;
import local.playplex.service.TicketService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.testcontainers.containers.Container;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * docs/07 task 0.5b, the test that catches the 5½-hour trap before it costs you the event.
 *
 * A session is written through JPA, then read back two ways: through JDBC, and through the
 * `mysql` client inside the container. If the three UTC settings are ever dropped — the
 * connection time zone, the server default, or the JVM — these disagree by the local offset
 * and every countdown in the app is wrong.
 */
class TimezoneRoundTripTest extends IntegrationTestBase {

    @Autowired TicketService tickets;
    @Autowired SessionService sessions;
    @Autowired DeviceRepository devices;
    @Autowired PlaySessionRepository playSessions;

    private static final CurrentUser ADMIN = new CurrentUser(1L, "admin", Role.ADMIN);

    @Test
    void sessionTimestampsAreUtcThroughEveryLayer() throws Exception {
        Device device = devices.findByCode("SIM-01").orElseThrow();
        TicketDto ticket = tickets.create(new CreateTicketRequest(
                new StudentInput("Clock Check", "9812345678", null, null, null),
                null, 1L, device.getDeviceType().getId(),
                new PaymentInput(PaymentMethod.CASH, 3000, null, null), null), ADMIN);

        Instant before = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        SessionSummaryDto started = sessions.start(
                new StartSessionRequest(device.getId(), List.of(ticket.id()), null), ADMIN);

        // 1. Through JPA: the instant we just wrote is now, not now ± an offset.
        PlaySession reloaded = playSessions.findById(started.id()).orElseThrow();
        assertThat(Duration.between(before, reloaded.getStartedAt()).abs())
                .as("JPA round-trip stays within a few seconds of real time")
                .isLessThan(Duration.ofMinutes(1));

        // 2. Through the mysql client in the container: the stored text must match the
        //    UTC instant, not the JVM's local rendering of it.
        Container.ExecResult result = MYSQL.execInContainer("mysql", "-uplayplex", "-pplayplex",
                "playplex", "-N", "-B", "-e",
                "SELECT DATE_FORMAT(started_at, '%Y-%m-%dT%H:%i:%S'), @@global.time_zone, @@session.time_zone "
                        + "FROM play_session WHERE id = " + started.id());
        String[] columns = result.getStdout().trim().split("\\s+");

        String expected = reloaded.getStartedAt().truncatedTo(ChronoUnit.SECONDS).toString().replace("Z", "");
        assertThat(columns[0]).as("the database and the application agree on the instant").isEqualTo(expected);
        assertThat(columns[1]).as("server default time zone is UTC").isEqualTo("+00:00");
        assertThat(columns[2]).as("session time zone is UTC").isEqualTo("+00:00");

        // 3. The planned end is exactly the plan length later — no daylight-saving drift.
        assertThat(Duration.between(reloaded.getStartedAt(), reloaded.getPlannedEndAt()))
                .isEqualTo(Duration.ofMinutes(15));
    }
}

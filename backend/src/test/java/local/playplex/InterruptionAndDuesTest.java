package local.playplex;

import local.playplex.api.dto.SessionDtos.SessionSummaryDto;
import local.playplex.api.dto.SessionDtos.StartSessionRequest;
import local.playplex.api.dto.TicketDtos.CreateTicketRequest;
import local.playplex.api.dto.TicketDtos.PaymentInput;
import local.playplex.api.dto.TicketDtos.StudentInput;
import local.playplex.api.dto.TicketDtos.TicketDto;
import local.playplex.domain.*;
import local.playplex.error.ApiException;
import local.playplex.error.ErrorCode;
import local.playplex.repo.*;
import local.playplex.security.CurrentUser;
import local.playplex.service.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The rules a fault exercises: the pause budget, the reissue, and the money owed either way. */
class InterruptionAndDuesTest extends IntegrationTestBase {

    @Autowired TicketService tickets;
    @Autowired SessionService sessions;
    @Autowired PauseService pauses;
    @Autowired ExtensionService extensions;
    @Autowired DeviceService deviceService;
    @Autowired ReceptionService reception;
    @Autowired SweepService sweeps;
    @Autowired DeviceRepository devices;
    @Autowired PlaySessionRepository sessionRepo;
    @Autowired EventSettingsRepository settings;

    private static final CurrentUser ADMIN = new CurrentUser(1L, "admin", Role.ADMIN);
    private static final AtomicInteger PHONE = new AtomicInteger(0);

    private SessionSummaryDto startOn(String deviceCode, long planId) {
        Device device = devices.findByCode(deviceCode).orElseThrow();
        TicketDto ticket = tickets.create(new CreateTicketRequest(
                new StudentInput("Player " + PHONE.get(), "97000000" + String.format("%02d", PHONE.incrementAndGet()),
                        null, null, null),
                null, planId, device.getDeviceType().getId(),
                new PaymentInput(PaymentMethod.CASH, planId == 1 ? 3000 : 5000, null, null), null), ADMIN);
        // Earlier tests leave people queued, so taking this brand-new ticket is a skip —
        // which the server rightly refuses without a reason.
        return sessions.start(new StartSessionRequest(device.getId(), List.of(ticket.id()),
                SkipReason.OTHER), ADMIN);
    }

    @Test
    void pauseHoldsTheClockAndHandsEveryPausedSecondBack() {
        SessionSummaryDto started = startOn("LAP-05", 2L);
        var before = sessionRepo.findById(started.id()).orElseThrow().getPlannedEndAt();

        pauses.pause(started.id(), PauseReason.GAME_CRASH, null, ADMIN);
        assertThat(sessionRepo.findById(started.id()).orElseThrow().getPausedAt()).isNotNull();

        // Pausing twice is a conflict, not a second pause.
        assertThatThrownBy(() -> pauses.pause(started.id(), PauseReason.POWER, null, ADMIN))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).code()).isEqualTo(ErrorCode.INVALID_TRANSITION);

        pauses.resume(started.id(), ADMIN);
        var after = sessionRepo.findById(started.id()).orElseThrow();
        assertThat(after.getPausedAt()).isNull();
        // The end time moved forward by however long it was held — never less, never more.
        assertThat(after.getPlannedEndAt()).isAfterOrEqualTo(before);
        assertThat(Duration.between(before, after.getPlannedEndAt()).toSeconds())
                .isEqualTo(after.getPausedTotalSeconds());
    }

    @Test
    void theBudgetIsSharedWithLostTimeAndThenRefused() {
        EventSettings config = settings.findById((short) 1).orElseThrow();
        config.setMaxPauseMinutes((short) 5);
        settings.save(config);

        SessionSummaryDto started = startOn("LAP-06", 2L);
        // Hand back the whole budget as lost time...
        pauses.giveBackLostTime(started.id(), 5, PauseReason.NETWORK, null, ADMIN);
        assertThat(sessionRepo.findById(started.id()).orElseThrow().getPausedTotalSeconds()).isEqualTo(300);

        // ...and there is nothing left to pause with.
        assertThatThrownBy(() -> pauses.pause(started.id(), PauseReason.GAME_CRASH, null, ADMIN))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).code()).isEqualTo(ErrorCode.BUSINESS_RULE_VIOLATED);
    }

    @Test
    void aFaultMidSessionReissuesTheTurnAndOwesTheStudentMoney() {
        SessionSummaryDto started = startOn("LAP-07", 2L);
        Long ticketId = sessionRepo.findById(started.id()).orElseThrow().getId();

        Device device = devices.findByCode("LAP-07").orElseThrow();
        deviceService.changeStatus(device.getId(), DeviceStatus.OUT_OF_SERVICE, "Charger dead", ADMIN);

        var session = sessionRepo.findById(started.id()).orElseThrow();
        assertThat(session.getEndedAt()).isNotNull();
        assertThat(session.getEndReason()).isEqualTo(EndReason.TECH_ISSUE);
        assertThat(devices.findByCode("LAP-07").orElseThrow().getStatus())
                .as("the station stays out of service, it does not go to cleaning")
                .isEqualTo(DeviceStatus.OUT_OF_SERVICE);

        var detail = reception.detail(Long.valueOf(started.ticketNos().isEmpty() ? ticketId
                : findTicketId(started)));
        assertThat(detail.ticket().status()).as("their turn is reissued at the front")
                .isEqualTo(TicketStatus.QUEUED);
        assertThat(detail.ticket().priority()).isGreaterThan(0);
        assertThat(detail.ticket().paymentStatus()).isEqualTo(PaymentStatus.REFUND_DUE);
        assertThat(detail.ticket().amountDuePaise()).isEqualTo(5000);
    }

    @Test
    void anUnpaidExtensionLandsOnTheDuesTabAndClearsWhenCollected() {
        SessionSummaryDto started = startOn("LAP-08", 2L);
        extensions.extend(started.id(), 15, false, ADMIN);

        long ticketId = findTicketId(started);
        var flagged = reception.detail(ticketId).ticket();
        assertThat(flagged.paymentStatus()).isEqualTo(PaymentStatus.PAYMENT_DUE);
        // 15 minutes costs what a 15-minute plan costs, not a made-up number.
        assertThat(flagged.amountDuePaise()).isEqualTo(3000);

        var settled = reception.settle(ticketId, new local.playplex.api.dto.TicketDtos.SettleRequest(
                PaymentKind.EXTENSION, PaymentMethod.CASH, 3000, null, null), ADMIN);
        assertThat(settled.ticket().paymentStatus()).isEqualTo(PaymentStatus.PAID);
        assertThat(settled.ticket().amountDuePaise()).isZero();
        // The ledger is append-only: the original sale plus the extension.
        assertThat(settled.payments()).hasSize(2);
        assertThat(settled.ticket().balancePaise()).isEqualTo(8000);
    }

    @Test
    void theOverdueSweepAnnouncesEachSessionOnlyOnce() {
        SessionSummaryDto started = startOn("LAP-09", 1L);
        var session = sessionRepo.findById(started.id()).orElseThrow();
        session.setPlannedEndAt(session.getStartedAt().minus(Duration.ofMinutes(1)));
        sessionRepo.save(session);

        sweeps.runAll();
        var firstPass = sessionRepo.findById(started.id()).orElseThrow().getOverdueNotifiedAt();
        assertThat(firstPass).as("the first sweep flags it").isNotNull();

        sweeps.runAll();
        assertThat(sessionRepo.findById(started.id()).orElseThrow().getOverdueNotifiedAt())
                .as("later sweeps do not re-announce it").isEqualTo(firstPass);
    }

    private long findTicketId(SessionSummaryDto session) {
        return reception.list(session.ticketNos().get(0), null, false, 0, 10)
                .content().get(0).id();
    }
}

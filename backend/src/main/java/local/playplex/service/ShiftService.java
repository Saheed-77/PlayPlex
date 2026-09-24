package local.playplex.service;

import local.playplex.api.dto.SessionDtos.DownDto;
import local.playplex.api.dto.SessionDtos.DueDto;
import local.playplex.api.dto.SessionDtos.HandoverSummary;
import local.playplex.api.dto.SessionDtos.RunningDto;
import local.playplex.domain.*;
import local.playplex.repo.*;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Handover is a five-line checklist, not a conversation (docs/02 §9). It works because no
 * state was ever local: the incoming volunteer sees a byte-identical board.
 */
@Service
public class ShiftService {

    private final PlaySessionRepository sessions;
    private final PlaySessionPlayerRepository players;
    private final DeviceRepository devices;
    private final TicketRepository tickets;
    private final StaffUserRepository users;
    private final AuditService audit;
    private final Clock clock;

    public ShiftService(PlaySessionRepository sessions, PlaySessionPlayerRepository players,
                        DeviceRepository devices, TicketRepository tickets, StaffUserRepository users,
                        AuditService audit, Clock clock) {
        this.sessions = sessions;
        this.players = players;
        this.devices = devices;
        this.tickets = tickets;
        this.users = users;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public HandoverSummary summary(CurrentUser actor) {
        Instant now = clock.instant();
        StaffUser user = users.findById(actor.id()).orElseThrow();
        List<PlaySession> active = sessions.findActive();

        List<RunningDto> running = active.stream()
                .filter(s -> !s.getPlannedEndAt().isBefore(now))
                .map(s -> new RunningDto(s.getDevice().getCode(), s.getPlannedEndAt(), playerNames(s)))
                .toList();
        List<RunningDto> overdue = active.stream()
                .filter(s -> s.getPlannedEndAt().isBefore(now) && s.getPausedAt() == null)
                .map(s -> new RunningDto(s.getDevice().getCode(), s.getPlannedEndAt(), playerNames(s)))
                .toList();
        List<DownDto> down = devices.findByActiveTrueAndStatus(DeviceStatus.OUT_OF_SERVICE).stream()
                .map(d -> new DownDto(d.getCode(), d.getStatusReason(), d.getStatusChangedAt()))
                .toList();
        List<DueDto> dues = tickets.findByStatusIn(List.of(TicketStatus.values())).stream()
                .filter(t -> t.getPaymentStatus() == PaymentStatus.PAYMENT_DUE)
                .map(t -> new DueDto(t.getTicketNo(), Names.firstName(t.getStudent().getFullName()),
                        t.getAmountDuePaise()))
                .toList();

        int started = (int) sessions.findAll().stream()
                .filter(s -> s.getStartedBy().getId().equals(actor.id()))
                .count();
        return new HandoverSummary(user.getFullName(), started, running, overdue, down, dues);
    }

    @Transactional
    public HandoverSummary endShift(CurrentUser actor) {
        HandoverSummary summary = summary(actor);
        // Both names sit in the audit log against this timestamp.
        audit.record(actor.id(), "SHIFT_ENDED", "staff_user", actor.id(), actor.username(),
                Map.of("sessionsStarted", summary.sessionsStarted(),
                        "overdueLeft", summary.overdue().size(),
                        "duesLeft", summary.paymentDue().size()));
        return summary;
    }

    private List<String> playerNames(PlaySession session) {
        return players.findBySession(session.getId()).stream()
                .map(p -> Names.firstName(p.getTicket().getStudent().getFullName()))
                .toList();
    }
}

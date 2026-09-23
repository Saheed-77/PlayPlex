package local.playplex.service;

import local.playplex.api.dto.SessionDtos.SessionSummaryDto;
import local.playplex.api.dto.SessionDtos.StartSessionRequest;
import local.playplex.domain.*;
import local.playplex.error.ApiException;
import local.playplex.error.ErrorCode;
import local.playplex.repo.*;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/** Assigning a device and running the timer (docs/02 §4, docs/04 §6). */
@Service
public class SessionService {

    private final DeviceRepository devices;
    private final TicketRepository tickets;
    private final PlaySessionRepository sessions;
    private final PlaySessionPlayerRepository players;
    private final PlaySessionEventRepository sessionEvents;
    private final DeviceStatusLogRepository statusLog;
    private final PaymentRepository payments;
    private final StaffUserRepository users;
    private final SettingsService settingsService;
    private final AuditService audit;
    private final Clock clock;

    public SessionService(DeviceRepository devices, TicketRepository tickets, PlaySessionRepository sessions,
                          PlaySessionPlayerRepository players, PlaySessionEventRepository sessionEvents,
                          DeviceStatusLogRepository statusLog, PaymentRepository payments,
                          StaffUserRepository users, SettingsService settingsService, AuditService audit,
                          Clock clock) {
        this.devices = devices;
        this.tickets = tickets;
        this.sessions = sessions;
        this.players = players;
        this.sessionEvents = sessionEvents;
        this.statusLog = statusLog;
        this.payments = payments;
        this.users = users;
        this.settingsService = settingsService;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * The five guards, in order (docs/04 §6). The device row is locked with SELECT ... FOR
     * UPDATE so two volunteers tapping at the same instant serialise here; the unique index
     * on the generated column is the backstop if this is ever bypassed.
     */
    @Transactional
    public SessionSummaryDto start(StartSessionRequest request, CurrentUser actor) {
        Instant now = clock.instant();

        // Guard 1: the device exists, is active and is free.
        Device device = devices.findByIdForUpdate(request.deviceId())
                .filter(Device::isActive)
                .orElseThrow(() -> ApiException.notFound("Device"));
        if (device.getStatus() != DeviceStatus.AVAILABLE) {
            throw ApiException.conflict(ErrorCode.DEVICE_NOT_AVAILABLE, takenMessage(device));
        }

        List<Ticket> chosen = request.ticketIds().stream()
                .map(id -> tickets.findById(id).orElseThrow(() -> ApiException.notFound("Ticket")))
                .toList();

        // Guard 2: capacity. A Console Duo ticket fills two seats on its own.
        int seats = chosen.stream().mapToInt(Ticket::getSeatsPerTicket).sum();
        if (seats > device.getCapacity()) {
            throw ApiException.conflict(ErrorCode.CAPACITY_EXCEEDED, device.getCode() + " has "
                    + device.getCapacity() + (device.getCapacity() > 1 ? " seats" : " seat")
                    + "; that's " + seats + " players.");
        }

        // Guard 3: every ticket is still waiting, and paid up.
        for (Ticket t : chosen) {
            if (t.getStatus() != TicketStatus.QUEUED) {
                throw ApiException.conflict(ErrorCode.TICKET_NOT_QUEUED,
                        t.getTicketNo() + " is no longer in the queue.");
            }
            if (t.getPaymentStatus() == PaymentStatus.PAYMENT_DUE) {
                throw ApiException.conflict(ErrorCode.TICKET_NOT_QUEUED,
                        t.getTicketNo() + " owes money — send them to reception first.");
            }
        }

        // Guard 4: the device type matches what they are waiting for.
        for (Ticket t : chosen) {
            if (!FloorService.canTake(t, device)) {
                String wanted = t.getPreferredDeviceType() == null ? "a different device"
                        : t.getPreferredDeviceType().getName();
                throw ApiException.rule(t.getTicketNo() + " is waiting for " + wanted
                        + ", not a " + device.getDeviceType().getName() + ".");
            }
        }

        // Skipping the person at the head of this device's queue is allowed, but it needs a
        // reason and it is audited — that is what stops it becoming a favour economy.
        Ticket head = FloorService.nextUpByDevice(devices.findAllActiveWithType(), tickets.findQueue(null))
                .get(device.getId());
        if (head != null && chosen.stream().noneMatch(t -> t.getId().equals(head.getId()))) {
            if (request.skipReason() == null) {
                throw ApiException.validation("Say why " + head.getTicketNo() + " is being skipped.",
                        Map.of("skipReason", "Required."));
            }
            head.setSkippedCount((short) (head.getSkippedCount() + 1));
            audit.record(actor.id(), "QUEUE_SKIPPED", "ticket", head.getId(), head.getTicketNo(),
                    Map.of("reason", request.skipReason().name(), "device", device.getCode(),
                            "instead", chosen.stream().map(Ticket::getTicketNo).toList()));
        }

        // Guard 5: the session ends when the shortest plan ends, so nobody overstays what
        // they paid for.
        int minutes = chosen.stream().mapToInt(Ticket::getDurationMinutesSnapshot).min().orElseThrow();

        PlaySession session = new PlaySession();
        session.setDevice(device);
        session.setStartedAt(now);
        session.setPlannedEndAt(now.plus(Duration.ofMinutes(minutes)));
        session.setStartedBy(users.getReferenceById(actor.id()));
        sessions.save(session);

        short seat = 1;
        for (Ticket t : chosen) {
            PlaySessionPlayer player = new PlaySessionPlayer();
            player.setSession(session);
            player.setTicket(t);
            player.setSeatNo(seat);
            player.setActive(true);
            players.save(player);
            seat += t.getSeatsPerTicket();

            t.setStatus(TicketStatus.ASSIGNED);
            t.setAssignedAt(now);
            // Playing the reissued turn settles a pending tech-issue refund.
            if (t.getPaymentStatus() == PaymentStatus.REFUND_DUE) {
                t.setPaymentStatus(PaymentStatus.PAID);
                t.setAmountDuePaise(0);
            }
        }

        changeStatus(device, DeviceStatus.IN_USE, null, actor.id(), now);
        logEvent(session, SessionEventType.STARTED, actor.id(), now);
        return summarise(session, actor);
    }

    @Transactional
    public SessionSummaryDto end(Long sessionId, EndReason reason, String note, CurrentUser actor) {
        PlaySession session = sessions.findById(sessionId).orElseThrow(() -> ApiException.notFound("Session"));
        if (session.getEndedAt() != null) {
            throw ApiException.conflict(ErrorCode.SESSION_ALREADY_ENDED, "That session has already ended.");
        }
        if ((reason == EndReason.TECH_ISSUE || reason == EndReason.ADMIN_OVERRIDE) && TicketService.isBlank(note)) {
            throw ApiException.validation("Add a note explaining what happened.", Map.of("note", "Required."));
        }
        if (reason == EndReason.ADMIN_OVERRIDE && actor.role() != Role.ADMIN) {
            throw new ApiException(ErrorCode.INSUFFICIENT_ROLE, "Only admin can override.");
        }
        return finish(session, reason, note, actor, true);
    }

    /** Shared by end, force-end and the device-fault path. */
    @Transactional
    public SessionSummaryDto finish(PlaySession session, EndReason reason, String note, CurrentUser actor,
                                    boolean releaseDevice) {
        Instant now = clock.instant();
        session.setEndedAt(now);
        session.setEndReason(reason);
        session.setEndNote(TicketService.blankToNull(note));
        session.setEndedBy(users.getReferenceById(actor.id()));

        for (PlaySessionPlayer player : players.findBySession(session.getId())) {
            player.setActive(false);
            Ticket t = player.getTicket();
            if (reason == EndReason.TECH_ISSUE) {
                // Cut off by a fault: back to the front of the queue, and flagged for a
                // refund in case they would rather have their money back (docs/02 §7).
                t.setStatus(TicketStatus.QUEUED);
                t.setAssignedAt(null);
                t.setPriority((short) Math.max(1, t.getPriority()));
                if (t.getPaymentStatus() != PaymentStatus.PAYMENT_DUE
                        && t.getPaymentStatus() != PaymentStatus.WAIVED) {
                    t.setPaymentStatus(PaymentStatus.REFUND_DUE);
                    t.setAmountDuePaise(Math.max(0, payments.balanceOf(t.getId())));
                }
            } else {
                t.setStatus(TicketStatus.COMPLETED);
                t.setCompletedAt(now);
            }
        }

        if (releaseDevice) {
            EventSettings settings = settingsService.get();
            DeviceStatus next = settings.getCleaningAutoClearSeconds() == 0
                    ? DeviceStatus.AVAILABLE : DeviceStatus.CLEANING;
            changeStatus(session.getDevice(), next, null, actor.id(), now);
        }
        logEvent(session, SessionEventType.ENDED, actor.id(), now);
        return summarise(session, actor);
    }

    public void changeStatus(Device device, DeviceStatus status, String reason, Long actorId, Instant now) {
        DeviceStatusLog log = new DeviceStatusLog();
        log.setDevice(device);
        log.setFromStatus(device.getStatus());
        log.setToStatus(status);
        log.setReason(reason);
        log.setChangedAt(now);
        if (actorId != null) log.setBy(users.getReferenceById(actorId));
        statusLog.save(log);

        device.setStatus(status);
        device.setStatusReason(status == DeviceStatus.OUT_OF_SERVICE ? reason : null);
        device.setStatusChangedAt(now);
    }

    private void logEvent(PlaySession session, SessionEventType type, Long actorId, Instant now) {
        PlaySessionEvent event = new PlaySessionEvent();
        event.setSession(session);
        event.setType(type);
        event.setOccurredAt(now);
        if (actorId != null) event.setBy(users.getReferenceById(actorId));
        sessionEvents.save(event);
    }

    @Transactional(readOnly = true)
    public SessionSummaryDto summarise(PlaySession session, CurrentUser viewer) {
        List<PlaySessionPlayer> list = players.findBySession(session.getId());
        boolean volunteer = viewer.role() == Role.VOLUNTEER;
        List<String> names = list.stream()
                .map(p -> volunteer ? Names.firstName(p.getTicket().getStudent().getFullName())
                        : p.getTicket().getStudent().getFullName())
                .toList();
        List<String> ticketNos = list.stream().map(p -> p.getTicket().getTicketNo()).toList();
        Device device = session.getDevice();
        return new SessionSummaryDto(session.getId(), device.getCode(), device.getDeviceType().getCode(),
                session.getStartedAt(), session.getPlannedEndAt(), session.getEndedAt(), session.getEndReason(),
                session.getExtensionMinutesTotal(), session.getPausedAt(), session.getPausedTotalSeconds(),
                names, ticketNos, session.getStartedBy().getFullName());
    }

    /** "LAP-05 was just taken by Arun — try LAP-09" beats a raw 409 every time. */
    private String takenMessage(Device device) {
        String who = sessions.findActiveByDevice(device.getId())
                .map(s -> " by " + Names.firstName(s.getStartedBy().getFullName()))
                .orElse("");
        String alternative = devices.findByActiveTrueAndStatus(DeviceStatus.AVAILABLE).stream()
                .filter(d -> d.getDeviceType().getId().equals(device.getDeviceType().getId()))
                .filter(d -> !d.getId().equals(device.getId()))
                .map(d -> " — try " + d.getCode())
                .findFirst().orElse("");
        return device.getCode() + " was just taken" + who + alternative + ".";
    }
}

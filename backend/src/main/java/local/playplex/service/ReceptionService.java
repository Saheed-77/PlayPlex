package local.playplex.service;

import local.playplex.api.dto.TicketDtos.*;
import local.playplex.domain.*;
import local.playplex.error.ApiException;
import local.playplex.error.ErrorCode;
import local.playplex.live.LiveEvent;
import local.playplex.live.LiveEventPublisher;
import local.playplex.repo.*;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

/** Everything reception does to a ticket after it is sold (docs/04 §4, docs/05 R4/R5). */
@Service
public class ReceptionService {

    private final TicketRepository tickets;
    private final PaymentRepository payments;
    private final PlaySessionPlayerRepository players;
    private final DeviceTypeRepository deviceTypes;
    private final StaffUserRepository users;
    private final TicketService ticketService;
    private final SessionService sessionService;
    private final AuditService audit;
    private final QueueEventFactory queueEvents;
    private final LiveEventPublisher live;
    private final SettingsService settingsService;
    private final Clock clock;

    public ReceptionService(TicketRepository tickets, PaymentRepository payments,
                            PlaySessionPlayerRepository players, DeviceTypeRepository deviceTypes,
                            StaffUserRepository users, TicketService ticketService,
                            SessionService sessionService, AuditService audit,
                            QueueEventFactory queueEvents, LiveEventPublisher live,
                            SettingsService settingsService, Clock clock) {
        this.tickets = tickets;
        this.payments = payments;
        this.players = players;
        this.deviceTypes = deviceTypes;
        this.users = users;
        this.ticketService = ticketService;
        this.sessionService = sessionService;
        this.audit = audit;
        this.queueEvents = queueEvents;
        this.live = live;
        this.settingsService = settingsService;
        this.clock = clock;
    }

    /** Today's registrations: searchable, filterable, and the Dues view (docs/05 R4/R5). */
    @Transactional(readOnly = true)
    public PageDto<TicketDto> list(String query, TicketStatus status, boolean duesOnly, int page, int size) {
        Instant now = clock.instant();
        ZoneId zone = ZoneId.of(settingsService.get().getTimezone());
        LocalDate today = LocalDate.ofInstant(now, zone);
        Instant from = today.atStartOfDay(zone).toInstant();
        Instant to = today.plusDays(1).atStartOfDay(zone).toInstant();

        String needle = query == null ? "" : query.trim().toLowerCase();
        List<Ticket> matching = tickets.findCreatedBetween(from, to).stream()
                .filter(t -> status == null || t.getStatus() == status)
                .filter(t -> !duesOnly || t.getPaymentStatus() == PaymentStatus.PAYMENT_DUE
                        || t.getPaymentStatus() == PaymentStatus.REFUND_DUE)
                .filter(t -> needle.isEmpty()
                        || t.getTicketNo().toLowerCase().contains(needle)
                        || t.getStudent().getFullName().toLowerCase().contains(needle)
                        || t.getStudent().getPhone().contains(needle))
                .toList();

        int fromIndex = Math.min(page * size, matching.size());
        int toIndex = Math.min(fromIndex + size, matching.size());
        List<TicketDto> content = matching.subList(fromIndex, toIndex).stream()
                .map(t -> ticketService.toDto(t, now, false))
                .toList();
        return new PageDto<>(content, page, size, matching.size(),
                Math.max(1, (int) Math.ceil(matching.size() / (double) size)));
    }

    @Transactional(readOnly = true)
    public TicketDetailDto detail(Long id) {
        Ticket ticket = find(id);
        Instant now = clock.instant();
        List<PaymentDto> ledger = payments.findByTicketIdOrderByCollectedAtAsc(id).stream()
                .map(p -> new PaymentDto(p.getId(), p.getAmountPaise(), p.getKind(), p.getMethod(),
                        p.getReferenceNo(), p.getCollectedBy().getFullName(), p.getCollectedAt(), p.getNote()))
                .toList();
        List<SessionRef> sessionRefs = players.findByTicket(id).stream()
                .map(p -> {
                    PlaySession s = p.getSession();
                    return new SessionRef(s.getId(), s.getDevice().getCode(), s.getStartedAt(),
                            s.getPlannedEndAt(), s.getEndedAt(),
                            s.getEndReason() == null ? null : s.getEndReason().name(),
                            s.getExtensionMinutesTotal());
                })
                .toList();
        return new TicketDetailDto(ticketService.toDto(ticket, now, true), ledger, sessionRefs);
    }

    /** Only a waiting ticket can be edited; a fare difference is a separate sale (docs/02 E8). */
    @Transactional
    public TicketDto update(Long id, UpdateTicketRequest request, CurrentUser actor) {
        Ticket ticket = find(id);
        if (ticket.getStatus() != TicketStatus.QUEUED) {
            throw ApiException.conflict(ErrorCode.INVALID_TRANSITION, "Only a waiting ticket can be edited.");
        }
        String before = ticket.getPreferredDeviceType() == null ? null : ticket.getPreferredDeviceType().getCode();
        if (request.preferredDeviceTypeId() == null) {
            ticket.setPreferredDeviceType(null);
        } else {
            DeviceType type = deviceTypes.findById(request.preferredDeviceTypeId())
                    .orElseThrow(() -> ApiException.notFound("Device type"));
            Plan plan = ticket.getPlan();
            if (!plan.getDeviceTypes().isEmpty() && plan.getDeviceTypes().stream()
                    .noneMatch(t -> t.getId().equals(type.getId()))) {
                throw ApiException.rule(ticket.getPlanNameSnapshot()
                        + " can't be played on that device. Sell a different plan instead.");
            }
            ticket.setPreferredDeviceType(type);
        }
        if (request.notes() != null) ticket.setNotes(TicketService.blankToNull(request.notes()));
        audit.record(actor.id(), "TICKET_UPDATED", "ticket", ticket.getId(), ticket.getTicketNo(),
                Map.of("preferredDeviceType", String.valueOf(before)),
                Map.of("preferredDeviceType", ticket.getPreferredDeviceType() == null ? "Any"
                        : ticket.getPreferredDeviceType().getCode()));
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        return ticketService.toDto(ticket, clock.instant(), true);
    }

    @Transactional
    public TicketDto cancel(Long id, CancelRequest request, CurrentUser actor) {
        Ticket ticket = find(id);
        boolean admin = actor.role() == Role.ADMIN;
        List<TicketStatus> allowed = admin
                ? List.of(TicketStatus.QUEUED, TicketStatus.NO_SHOW, TicketStatus.ASSIGNED)
                : List.of(TicketStatus.QUEUED, TicketStatus.NO_SHOW);
        if (!allowed.contains(ticket.getStatus())) {
            throw ApiException.conflict(ErrorCode.INVALID_TRANSITION,
                    "A " + ticket.getStatus().name().toLowerCase() + " ticket can't be cancelled here.");
        }
        if (ticket.getStatus() == TicketStatus.ASSIGNED) {
            players.findByTicket(ticket.getId()).stream()
                    .filter(PlaySessionPlayer::isActive)
                    .findFirst()
                    .ifPresent(p -> sessionService.finish(p.getSession(), EndReason.ADMIN_OVERRIDE,
                            "Ticket cancelled: " + request.reason(), actor, true));
        }

        Instant now = clock.instant();
        ticket.setStatus(TicketStatus.CANCELLED);
        ticket.setCancelledAt(now);

        int balance = payments.balanceOf(ticket.getId());
        if (request.refund() && balance > 0) {
            // A refund is a new row with a negative amount, never an edit (docs/03 §2.8).
            writePayment(ticket, -balance, PaymentKind.REFUND,
                    request.method() == null ? PaymentMethod.CASH : request.method(),
                    null, request.reason(), actor, now);
            ticket.setPaymentStatus(PaymentStatus.REFUNDED);
            ticket.setAmountDuePaise(0);
        }
        audit.record(actor.id(), "TICKET_CANCELLED", "ticket", ticket.getId(), ticket.getTicketNo(),
                Map.of("status", "QUEUED"),
                Map.of("status", "CANCELLED", "refund", request.refund(), "reason", request.reason()));
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        live.ticketFlagged(ticket.getId(), ticket.getTicketNo(), null);
        return ticketService.toDto(ticket, now, false);
    }

    /** Collect an extension that was played on credit, or pay back a tech-issue refund. */
    @Transactional
    public TicketDetailDto settle(Long id, SettleRequest request, CurrentUser actor) {
        Ticket ticket = find(id);
        Instant now = clock.instant();
        if (request.method() != PaymentMethod.CASH && request.method() != PaymentMethod.UPI) {
            throw ApiException.validation("Choose cash or UPI.", Map.of("method", "Choose cash or UPI."));
        }

        if (request.kind() == PaymentKind.EXTENSION) {
            if (ticket.getPaymentStatus() != PaymentStatus.PAYMENT_DUE) {
                throw ApiException.conflict(ErrorCode.INVALID_TRANSITION,
                        ticket.getTicketNo() + " has nothing due.");
            }
            if (request.amountPaise() != ticket.getAmountDuePaise()) {
                throw ApiException.validation("Collect the exact amount due.",
                        Map.of("amountPaise", "Collect the exact amount due."));
            }
            writePayment(ticket, request.amountPaise(), PaymentKind.EXTENSION, request.method(),
                    request.referenceNo(), request.note(), actor, now);
            ticket.setPaymentStatus(PaymentStatus.PAID);
            ticket.setAmountDuePaise(0);
            audit.record(actor.id(), "PAYMENT_COLLECTED", "ticket", ticket.getId(), ticket.getTicketNo(),
                    Map.of("amountPaise", request.amountPaise(), "method", request.method().name()));
        } else if (request.kind() == PaymentKind.REFUND) {
            if (ticket.getPaymentStatus() != PaymentStatus.REFUND_DUE && actor.role() != Role.ADMIN) {
                throw new ApiException(ErrorCode.INSUFFICIENT_ROLE,
                        "Only admin can refund a ticket that is not flagged for refund.");
            }
            int balance = payments.balanceOf(ticket.getId());
            if (request.amountPaise() <= 0 || request.amountPaise() > balance) {
                throw ApiException.validation("Refund must be between 1 and the ticket balance.",
                        Map.of("amountPaise", "Refund must be between 1 and the ticket balance."));
            }
            if (TicketService.isBlank(request.note())) {
                throw ApiException.validation("Add a note for the refund.", Map.of("note", "Required."));
            }
            writePayment(ticket, -request.amountPaise(), PaymentKind.REFUND, request.method(),
                    request.referenceNo(), request.note(), actor, now);
            ticket.setPaymentStatus(PaymentStatus.REFUNDED);
            ticket.setAmountDuePaise(0);
            // Taking the money back means giving up the reissued turn.
            if (ticket.getStatus() == TicketStatus.QUEUED) {
                ticket.setStatus(TicketStatus.CANCELLED);
                ticket.setCancelledAt(now);
                live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
            }
            audit.record(actor.id(), "REFUND_ISSUED", "ticket", ticket.getId(), ticket.getTicketNo(),
                    Map.of("amountPaise", -request.amountPaise(), "method", request.method().name()));
        } else {
            throw ApiException.validation("Unknown payment kind.", Map.of("kind", "Unknown payment kind."));
        }
        live.ticketFlagged(ticket.getId(), ticket.getTicketNo(), null);
        return detail(id);
    }

    @Transactional
    public TicketDto markNoShow(Long id, CurrentUser actor) {
        Ticket ticket = find(id);
        if (ticket.getStatus() != TicketStatus.QUEUED) {
            throw ApiException.conflict(ErrorCode.TICKET_NOT_QUEUED,
                    ticket.getTicketNo() + " is not waiting any more.");
        }
        ticket.setStatus(TicketStatus.NO_SHOW);
        ticket.setNoShowCount((short) (ticket.getNoShowCount() + 1));
        audit.record(actor.id(), "TICKET_NO_SHOW", "ticket", ticket.getId(), ticket.getTicketNo(),
                Map.of("status", "NO_SHOW"));
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        return ticketService.toDto(ticket, clock.instant(), false);
    }

    /** The original queued_at is kept, so they land near the front (docs/02 E2). */
    @Transactional
    public TicketDto requeue(Long id, CurrentUser actor) {
        Ticket ticket = find(id);
        if (ticket.getStatus() != TicketStatus.NO_SHOW) {
            throw ApiException.conflict(ErrorCode.INVALID_TRANSITION,
                    "Only a no-show can be put back in the queue.");
        }
        ticket.setStatus(TicketStatus.QUEUED);
        audit.record(actor.id(), "TICKET_REQUEUED", "ticket", ticket.getId(), ticket.getTicketNo(),
                Map.of("status", "QUEUED"));
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        return ticketService.toDto(ticket, clock.instant(), true);
    }

    /** Audited, because that is what stops priority becoming a favour economy. */
    @Transactional
    public TicketDto setPriority(Long id, short priority, String reason, CurrentUser actor) {
        Ticket ticket = find(id);
        if (priority < 0 || priority > 5) {
            throw ApiException.validation("Priority must be 0–5.", Map.of("priority", "Priority must be 0–5."));
        }
        short before = ticket.getPriority();
        ticket.setPriority(priority);
        audit.record(actor.id(), "PRIORITY_BUMPED", "ticket", ticket.getId(), ticket.getTicketNo(),
                Map.of("priority", before), Map.of("priority", priority, "reason", reason));
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        return ticketService.toDto(ticket, clock.instant(), true);
    }

    private void writePayment(Ticket ticket, int amount, PaymentKind kind, PaymentMethod method,
                              String reference, String note, CurrentUser actor, Instant now) {
        Payment payment = new Payment();
        payment.setTicket(ticket);
        payment.setAmountPaise(amount);
        payment.setKind(kind);
        payment.setMethod(method);
        payment.setReferenceNo(TicketService.blankToNull(reference));
        payment.setCollectedBy(users.getReferenceById(actor.id()));
        payment.setCollectedAt(now);
        payment.setNote(TicketService.blankToNull(note));
        payments.save(payment);
    }

    private Ticket find(Long id) {
        return tickets.findById(id).orElseThrow(() -> ApiException.notFound("Ticket"));
    }
}

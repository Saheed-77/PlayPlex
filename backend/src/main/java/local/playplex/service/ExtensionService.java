package local.playplex.service;

import local.playplex.api.dto.SessionDtos.SessionSummaryDto;
import local.playplex.domain.*;
import local.playplex.error.ApiException;
import local.playplex.error.ErrorCode;
import local.playplex.live.LiveEvent;
import local.playplex.live.LiveEventPublisher;
import local.playplex.repo.PlanRepository;
import local.playplex.repo.PlaySessionEventRepository;
import local.playplex.repo.PlaySessionPlayerRepository;
import local.playplex.repo.PlaySessionRepository;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * "Extend first, collect later — never interrupt play to chase cash" (docs/05 V3). The
 * Dues tab is what makes that safe: the minutes are added now and the ticket is flagged
 * so reception collects when the student passes the desk.
 */
@Service
public class ExtensionService {

    private final PlaySessionRepository sessions;
    private final PlaySessionPlayerRepository players;
    private final PlaySessionEventRepository sessionEvents;
    private final PlanRepository plans;
    private final SettingsService settingsService;
    private final SessionService sessionService;
    private final AuditService audit;
    private final QueueEventFactory queueEvents;
    private final LiveEventPublisher live;
    private final Clock clock;

    public ExtensionService(PlaySessionRepository sessions, PlaySessionPlayerRepository players,
                            PlaySessionEventRepository sessionEvents, PlanRepository plans,
                            SettingsService settingsService, SessionService sessionService,
                            AuditService audit, QueueEventFactory queueEvents,
                            LiveEventPublisher live, Clock clock) {
        this.sessions = sessions;
        this.players = players;
        this.sessionEvents = sessionEvents;
        this.plans = plans;
        this.settingsService = settingsService;
        this.sessionService = sessionService;
        this.audit = audit;
        this.queueEvents = queueEvents;
        this.live = live;
        this.clock = clock;
    }

    @Transactional
    public SessionSummaryDto extend(Long sessionId, int minutes, boolean collectPayment, CurrentUser actor) {
        PlaySession session = sessions.findById(sessionId)
                .orElseThrow(() -> ApiException.notFound("Session"));
        if (session.getEndedAt() != null) {
            throw ApiException.conflict(ErrorCode.SESSION_ALREADY_ENDED, "That session has already ended.");
        }
        EventSettings settings = settingsService.get();
        if (!settings.isAllowExtensions()) {
            throw ApiException.rule("Extensions are switched off for this event.");
        }
        if (minutes <= 0) {
            throw ApiException.validation("Pick how many minutes to add.", Map.of("minutes", "Required."));
        }
        int alreadyAdded = session.getExtensionMinutesTotal();
        if (alreadyAdded + minutes > settings.getMaxExtensionMinutes()) {
            int left = settings.getMaxExtensionMinutes() - alreadyAdded;
            throw ApiException.rule(left > 0
                    ? "Only " + left + " more minutes can be added to this session."
                    : "This session has used all its extension time.");
        }

        session.setPlannedEndAt(session.getPlannedEndAt().plus(Duration.ofMinutes(minutes)));
        session.setExtensionMinutesTotal((short) (alreadyAdded + minutes));
        // The clock moved, so the overdue alert is allowed to fire again later.
        session.setOverdueNotifiedAt(null);

        Device device = session.getDevice();
        if (!collectPayment) {
            // Flagged for the Dues tab, which must be empty before close.
            int price = extensionPrice(device.getDeviceType(), minutes);
            for (PlaySessionPlayer player : players.findBySession(session.getId())) {
                Ticket ticket = player.getTicket();
                if (ticket.getPaymentStatus() == PaymentStatus.WAIVED) continue;
                ticket.setPaymentStatus(PaymentStatus.PAYMENT_DUE);
                ticket.setAmountDuePaise(ticket.getAmountDuePaise() + price);
                live.ticketFlagged(ticket.getId(), ticket.getTicketNo(), PaymentStatus.PAYMENT_DUE.name());
            }
        }

        PlaySessionEvent event = new PlaySessionEvent();
        event.setSession(session);
        event.setType(SessionEventType.EXTENDED);
        event.setOccurredAt(clock.instant());
        sessionEvents.save(event);

        audit.record(actor.id(), "SESSION_EXTENDED", "play_session", session.getId(), device.getCode(),
                Map.of("minutes", minutes, "collectAtDesk", !collectPayment));

        Map<String, Object> data = new HashMap<>();
        data.put("sessionId", session.getId());
        data.put("plannedEndAt", session.getPlannedEndAt());
        data.put("minutesAdded", minutes);
        live.publish(LiveEvent.Type.SESSION_EXTENDED, data);
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        return sessionService.summarise(session, actor);
    }

    /**
     * What reception will collect: the single-seat plan with exactly that duration for this
     * device type, most specific first, falling back to the pro-rata rate.
     */
    public int extensionPrice(DeviceType deviceType, int minutes) {
        List<Plan> candidates = plans.findActiveWithTypes().stream()
                .filter(p -> p.getDurationMinutes() == minutes && p.getSeatsPerTicket() == 1)
                .filter(p -> p.getDeviceTypes().isEmpty() || p.getDeviceTypes().stream()
                        .anyMatch(t -> t.getId().equals(deviceType.getId())))
                .sorted(Comparator.comparingInt((Plan p) -> p.getDeviceTypes().size()).reversed())
                .toList();
        if (!candidates.isEmpty()) return candidates.get(0).getPricePaise();

        return plans.findActiveWithTypes().stream()
                .filter(p -> p.getSeatsPerTicket() == 1)
                .findFirst()
                .map(p -> Math.round((float) p.getPricePaise() / p.getDurationMinutes() * minutes / 100) * 100)
                .orElse(0);
    }
}

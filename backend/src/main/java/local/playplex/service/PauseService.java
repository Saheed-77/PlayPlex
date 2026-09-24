package local.playplex.service;

import local.playplex.api.dto.SessionDtos.SessionSummaryDto;
import local.playplex.domain.*;
import local.playplex.error.ApiException;
import local.playplex.error.ErrorCode;
import local.playplex.live.LiveEvent;
import local.playplex.live.LiveEventPublisher;
import local.playplex.repo.PlaySessionEventRepository;
import local.playplex.repo.PlaySessionPlayerRepository;
import local.playplex.repo.PlaySessionRepository;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Interruptions (docs/02 §8). A pause holds a station idle while people queue, so it is
 * bounded by design: a budget per session, an automatic resume at the cap (SweepService),
 * no pausing once the time is already up, technical reasons only, and every action audited.
 */
@Service
public class PauseService {

    private final PlaySessionRepository sessions;
    private final PlaySessionPlayerRepository players;
    private final PlaySessionEventRepository sessionEvents;
    private final SettingsService settingsService;
    private final SessionService sessionService;
    private final AuditService audit;
    private final QueueEventFactory queueEvents;
    private final LiveEventPublisher live;
    private final Clock clock;

    public PauseService(PlaySessionRepository sessions, PlaySessionPlayerRepository players,
                        PlaySessionEventRepository sessionEvents, SettingsService settingsService,
                        SessionService sessionService, AuditService audit,
                        QueueEventFactory queueEvents, LiveEventPublisher live, Clock clock) {
        this.sessions = sessions;
        this.players = players;
        this.sessionEvents = sessionEvents;
        this.settingsService = settingsService;
        this.sessionService = sessionService;
        this.audit = audit;
        this.queueEvents = queueEvents;
        this.live = live;
        this.clock = clock;
    }

    @Transactional
    public SessionSummaryDto pause(Long sessionId, PauseReason reason, String note, CurrentUser actor) {
        Instant now = clock.instant();
        PlaySession session = running(sessionId);
        EventSettings settings = settingsService.get();
        Device device = session.getDevice();

        if (session.getPausedAt() != null) {
            throw ApiException.conflict(ErrorCode.INVALID_TRANSITION, device.getCode() + " is already paused.");
        }
        if (settings.getMaxPauseMinutes() <= 0) {
            throw ApiException.rule("Pausing is switched off for this event.");
        }
        // Pause protects time still owed; it is not a source of free minutes.
        if (!session.getPlannedEndAt().isAfter(now)) {
            throw ApiException.rule(device.getCode()
                    + " is already out of time — end it or add 15 minutes instead.");
        }
        Duration left = budgetLeft(session, settings, now);
        if (left.isZero() || left.isNegative()) {
            throw ApiException.rule(device.getCode() + " has used its " + settings.getMaxPauseMinutes()
                    + " minutes of pause. End it as a tech issue if the fault continues.");
        }
        if (reason == PauseReason.OTHER && TicketService.isBlank(note)) {
            throw ApiException.validation("Say what happened.", Map.of("note", "Required."));
        }

        session.setPausedAt(now);
        session.setPauseReason(reason);
        logEvent(session, SessionEventType.PAUSED, actor, now);
        audit.record(actor.id(), "SESSION_PAUSED", "play_session", session.getId(), device.getCode(),
                Map.of("reason", reason.name(), "budgetLeftSeconds", left.toSeconds()));

        Map<String, Object> data = new HashMap<>();
        data.put("sessionId", session.getId());
        data.put("deviceId", device.getId());
        data.put("deviceCode", device.getCode());
        data.put("reason", reason.name());
        data.put("pausedAt", now);
        live.publish(LiveEvent.Type.SESSION_PAUSED, data);
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        return sessionService.summarise(session, actor);
    }

    @Transactional
    public SessionSummaryDto resume(Long sessionId, CurrentUser actor) {
        Instant now = clock.instant();
        PlaySession session = running(sessionId);
        Device device = session.getDevice();
        if (session.getPausedAt() == null) {
            throw ApiException.conflict(ErrorCode.INVALID_TRANSITION, device.getCode() + " is already running.");
        }

        // Every paused millisecond comes back as playable time, and not one more.
        long pausedMs = Math.max(0, Duration.between(session.getPausedAt(), now).toMillis());
        session.setPlannedEndAt(session.getPlannedEndAt().plusMillis(pausedMs));
        session.setPausedTotalSeconds(session.getPausedTotalSeconds() + (int) (pausedMs / 1000));
        session.setPausedAt(null);
        session.setPauseReason(null);
        session.setOverdueNotifiedAt(null);
        logEvent(session, SessionEventType.RESUMED, actor, now);
        audit.record(actor.id(), "SESSION_RESUMED", "play_session", session.getId(), device.getCode(),
                Map.of("pausedSeconds", pausedMs / 1000, "newEndAt", session.getPlannedEndAt().toString()));

        Map<String, Object> data = new HashMap<>();
        data.put("sessionId", session.getId());
        data.put("deviceId", device.getId());
        data.put("deviceCode", device.getCode());
        data.put("plannedEndAt", session.getPlannedEndAt());
        data.put("automatic", false);
        live.publish(LiveEvent.Type.SESSION_RESUMED, data);
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        return sessionService.summarise(session, actor);
    }

    /**
     * For a glitch that was over before anyone reached the tablet. It draws on the same
     * budget, so an interruption can never be both paused and gifted.
     */
    @Transactional
    public SessionSummaryDto giveBackLostTime(Long sessionId, int minutes, PauseReason reason,
                                              String note, CurrentUser actor) {
        Instant now = clock.instant();
        PlaySession session = running(sessionId);
        EventSettings settings = settingsService.get();
        Device device = session.getDevice();

        if (session.getPausedAt() != null) {
            throw ApiException.conflict(ErrorCode.INVALID_TRANSITION,
                    device.getCode() + " is paused — resume it instead.");
        }
        if (settings.getMaxPauseMinutes() <= 0) {
            throw ApiException.rule("Pausing is switched off for this event.");
        }
        if (minutes <= 0) {
            throw ApiException.validation("Pick how many minutes were lost.", Map.of("minutes", "Required."));
        }
        long minutesLeft = budgetLeft(session, settings, now).toMinutes();
        if (minutes > minutesLeft) {
            throw ApiException.rule(minutesLeft > 0
                    ? "Only " + minutesLeft + " more minute" + (minutesLeft == 1 ? "" : "s")
                      + " can be given back on this session."
                    : device.getCode() + " has used its " + settings.getMaxPauseMinutes() + " minutes of pause.");
        }

        session.setPlannedEndAt(session.getPlannedEndAt().plus(Duration.ofMinutes(minutes)));
        session.setPausedTotalSeconds(session.getPausedTotalSeconds() + minutes * 60);
        session.setOverdueNotifiedAt(null);
        audit.record(actor.id(), "SESSION_LOST_TIME", "play_session", session.getId(), device.getCode(),
                Map.of("minutes", minutes, "reason", reason.name()));

        Map<String, Object> data = new HashMap<>();
        data.put("sessionId", session.getId());
        data.put("deviceId", device.getId());
        data.put("deviceCode", device.getCode());
        data.put("plannedEndAt", session.getPlannedEndAt());
        data.put("automatic", false);
        live.publish(LiveEvent.Type.SESSION_RESUMED, data);
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        return sessionService.summarise(session, actor);
    }

    private Duration budgetLeft(PlaySession session, EventSettings settings, Instant now) {
        Duration spent = Duration.ofSeconds(session.getPausedTotalSeconds());
        if (session.getPausedAt() != null) spent = spent.plus(Duration.between(session.getPausedAt(), now));
        Duration left = Duration.ofMinutes(settings.getMaxPauseMinutes()).minus(spent);
        return left.isNegative() ? Duration.ZERO : left;
    }

    private PlaySession running(Long id) {
        PlaySession session = sessions.findById(id).orElseThrow(() -> ApiException.notFound("Session"));
        if (session.getEndedAt() != null) {
            throw ApiException.conflict(ErrorCode.SESSION_ALREADY_ENDED, "That session has already ended.");
        }
        return session;
    }

    private void logEvent(PlaySession session, SessionEventType type, CurrentUser actor, Instant at) {
        PlaySessionEvent event = new PlaySessionEvent();
        event.setSession(session);
        event.setType(type);
        event.setOccurredAt(at);
        sessionEvents.save(event);
    }
}

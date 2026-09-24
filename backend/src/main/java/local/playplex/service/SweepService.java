package local.playplex.service;

import local.playplex.domain.*;
import local.playplex.live.LiveEvent;
import local.playplex.live.LiveEventPublisher;
import local.playplex.repo.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Scheduled housekeeping. Each sweep is idempotent and commits its own transaction, so a
 * missed tick simply catches up on the next one.
 */
@Service
public class SweepService {

    private final PlaySessionRepository sessions;
    private final DeviceRepository devices;
    private final DeviceStatusLogRepository statusLog;
    private final PlaySessionEventRepository sessionEvents;
    private final IdempotencyKeyRepository idempotencyKeys;
    private final SettingsService settingsService;
    private final QueueEventFactory queueEvents;
    private final LiveEventPublisher live;
    private final AuditService audit;
    private final Clock clock;

    public SweepService(PlaySessionRepository sessions, DeviceRepository devices,
                        DeviceStatusLogRepository statusLog, PlaySessionEventRepository sessionEvents,
                        IdempotencyKeyRepository idempotencyKeys, SettingsService settingsService,
                        QueueEventFactory queueEvents, LiveEventPublisher live, AuditService audit,
                        Clock clock) {
        this.sessions = sessions;
        this.devices = devices;
        this.statusLog = statusLog;
        this.sessionEvents = sessionEvents;
        this.idempotencyKeys = idempotencyKeys;
        this.settingsService = settingsService;
        this.queueEvents = queueEvents;
        this.live = live;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    public void runAll() {
        EventSettings settings = settingsService.get();
        Instant now = clock.instant();
        boolean queueChanged = false;
        queueChanged |= resumePausedAtBudget(settings, now);
        queueChanged |= clearFinishedCleaning(settings, now);
        announceOverdue(now);
        if (queueChanged) {
            live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        }
    }

    /**
     * A forgotten pause must never hold a station: at the budget the clock restarts by
     * itself, and the player still gets back every second that was actually paused
     * (docs/02 §8.1).
     */
    private boolean resumePausedAtBudget(EventSettings settings, Instant now) {
        boolean changed = false;
        Duration budget = Duration.ofMinutes(settings.getMaxPauseMinutes());
        for (PlaySession session : sessions.findPaused()) {
            Duration spent = Duration.ofSeconds(session.getPausedTotalSeconds())
                    .plus(Duration.between(session.getPausedAt(), now));
            if (spent.compareTo(budget) < 0) continue;

            // Resume exactly on the boundary, not whenever the sweep happened to run.
            Duration remainingBudget = budget.minusSeconds(session.getPausedTotalSeconds());
            Instant resumeAt = session.getPausedAt().plus(remainingBudget);
            long pausedMs = Math.max(0, Duration.between(session.getPausedAt(), resumeAt).toMillis());
            session.setPlannedEndAt(session.getPlannedEndAt().plusMillis(pausedMs));
            session.setPausedTotalSeconds(session.getPausedTotalSeconds() + (int) (pausedMs / 1000));
            session.setPausedAt(null);
            session.setPauseReason(null);
            session.setOverdueNotifiedAt(null);
            logEvent(session, SessionEventType.RESUMED, resumeAt);
            // Audited like any other override: someone has to be able to explain, on
            // Monday, why a session ran longer than the plan said.
            audit.record(null, "SESSION_AUTO_RESUMED", "play_session", session.getId(),
                    session.getDevice().getCode(),
                    Map.of("reason", "Pause budget spent",
                            "maxPauseMinutes", settings.getMaxPauseMinutes(),
                            "pausedSeconds", pausedMs / 1000));

            Map<String, Object> data = new HashMap<>();
            data.put("sessionId", session.getId());
            data.put("deviceId", session.getDevice().getId());
            data.put("deviceCode", session.getDevice().getCode());
            data.put("plannedEndAt", session.getPlannedEndAt());
            data.put("automatic", true);
            live.publish(LiveEvent.Type.SESSION_RESUMED, data);
            changed = true;
        }
        return changed;
    }

    /** CLEANING clears itself after the configured delay (0 disables the state entirely). */
    private boolean clearFinishedCleaning(EventSettings settings, Instant now) {
        if (settings.getCleaningAutoClearSeconds() <= 0) return false;
        Duration delay = Duration.ofSeconds(settings.getCleaningAutoClearSeconds());
        boolean changed = false;
        for (Device device : devices.findByActiveTrueAndStatus(DeviceStatus.CLEANING)) {
            if (device.getStatusChangedAt().plus(delay).isAfter(now)) continue;
            Instant clearedAt = device.getStatusChangedAt().plus(delay);

            DeviceStatusLog log = new DeviceStatusLog();
            log.setDevice(device);
            log.setFromStatus(device.getStatus());
            log.setToStatus(DeviceStatus.AVAILABLE);
            log.setChangedAt(clearedAt);
            statusLog.save(log);

            device.setStatus(DeviceStatus.AVAILABLE);
            device.setStatusReason(null);
            device.setStatusChangedAt(clearedAt);
            live.deviceUpdated(device.getId(), device.getCode(), DeviceStatus.AVAILABLE, null);
            changed = true;
        }
        return changed;
    }

    /** Alerts once per session, not every ten seconds (docs/07 task 3.11). */
    private void announceOverdue(Instant now) {
        List<PlaySession> overdue = sessions.findNewlyOverdue(now);
        for (PlaySession session : overdue) {
            session.setOverdueNotifiedAt(now);
            logEvent(session, SessionEventType.OVERDUE, now);

            Map<String, Object> data = new HashMap<>();
            data.put("sessionId", session.getId());
            data.put("deviceId", session.getDevice().getId());
            data.put("deviceCode", session.getDevice().getCode());
            data.put("overdueSince", session.getPlannedEndAt());
            live.publish(LiveEvent.Type.SESSION_OVERDUE, data);
        }
    }

    @Transactional
    public int purgeOldIdempotencyKeys() {
        return idempotencyKeys.deleteOlderThan(clock.instant().minus(Duration.ofHours(24)));
    }

    private void logEvent(PlaySession session, SessionEventType type, Instant at) {
        PlaySessionEvent event = new PlaySessionEvent();
        event.setSession(session);
        event.setType(type);
        event.setOccurredAt(at);
        sessionEvents.save(event);
    }
}

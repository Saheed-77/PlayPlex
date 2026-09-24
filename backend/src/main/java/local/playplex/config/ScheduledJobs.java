package local.playplex.config;

import local.playplex.live.LiveEventBroadcaster;
import local.playplex.service.SweepService;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * The background work that makes the room honest without anyone pressing anything: overdue
 * alerts, cleaning clearing itself, and a forgotten pause restarting at its budget.
 */
@Configuration
@EnableScheduling
@EnableConfigurationProperties(AppProperties.class)
public class ScheduledJobs {

    private final SweepService sweeps;
    private final LiveEventBroadcaster broadcaster;

    public ScheduledJobs(SweepService sweeps, LiveEventBroadcaster broadcaster) {
        this.sweeps = sweeps;
        this.broadcaster = broadcaster;
    }

    /** Fast enough that "overdue" is visible within 15 seconds of expiry (docs/01 G2). */
    @Scheduled(fixedDelay = 10_000, initialDelay = 10_000)
    public void sweep() {
        sweeps.runAll();
    }

    /** Proxies kill idle connections; a comment every 20 seconds keeps them open. */
    @Scheduled(fixedDelay = 20_000, initialDelay = 20_000)
    public void heartbeat() {
        broadcaster.heartbeat();
    }

    /** Idempotency keys are kept for 24 hours (docs/04 §1), then swept hourly. */
    @Scheduled(fixedDelay = 3_600_000, initialDelay = 60_000)
    public void cleanUpIdempotencyKeys() {
        sweeps.purgeOldIdempotencyKeys();
    }
}

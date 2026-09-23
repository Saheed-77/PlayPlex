package local.playplex.api;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.util.Map;

/** Unauthenticated. What the ops dashboard on the admin laptop polls (docs/04 §12). */
@RestController
public class PingController {

    private final Clock clock;

    public PingController(Clock clock) { this.clock = clock; }

    @GetMapping("/api/ping")
    public Map<String, Object> ping() {
        return Map.of("status", "ok", "serverTime", clock.instant().toString());
    }
}

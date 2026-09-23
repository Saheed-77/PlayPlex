package local.playplex.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/**
 * One UTC clock, injected everywhere. Services never call Instant.now() directly, so
 * tests can drive time forward and the timezone discipline holds end to end (docs/03 §3.3).
 */
@Configuration
public class ClockConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}

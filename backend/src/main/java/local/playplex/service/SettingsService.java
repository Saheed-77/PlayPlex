package local.playplex.service;

import local.playplex.api.dto.FloorDtos.SettingsDto;
import local.playplex.domain.EventSettings;
import local.playplex.error.ApiException;
import local.playplex.repo.EventSettingsRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;

/** The single event_settings row: every operational knob, changeable without a redeploy. */
@Service
public class SettingsService {

    private final EventSettingsRepository repo;

    public SettingsService(EventSettingsRepository repo) { this.repo = repo; }

    @Transactional(readOnly = true)
    public EventSettings get() {
        return repo.findById((short) 1).orElseThrow(() -> ApiException.notFound("Event settings"));
    }

    public Duration cleaningDelay(EventSettings settings) {
        return Duration.ofSeconds(settings.getCleaningAutoClearSeconds());
    }

    public static SettingsDto toDto(EventSettings s) {
        return new SettingsDto(s.getEventName(), s.getWarningThresholdMinutes(),
                s.getCleaningAutoClearSeconds(), s.getMaxPauseMinutes(), s.isAllowExtensions(),
                s.getMaxExtensionMinutes(), s.getOpeningCashFloatPaise(), s.getTimezone());
    }
}

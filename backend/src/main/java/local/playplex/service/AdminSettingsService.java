package local.playplex.service;

import local.playplex.api.dto.AdminDtos.SettingsInput;
import local.playplex.api.dto.FloorDtos.SettingsDto;
import local.playplex.domain.EventSettings;
import local.playplex.error.ApiException;
import local.playplex.live.LiveEvent;
import local.playplex.live.LiveEventPublisher;
import local.playplex.repo.EventSettingsRepository;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Every knob in one row, changeable mid-event without a redeploy (docs/05 A5). The ranges
 * are enforced here rather than in the form, because the form is not the only caller and a
 * cleaning delay of an hour would strand the whole floor.
 */
@Service
public class AdminSettingsService {

    private final EventSettingsRepository repo;
    private final AuditService audit;
    private final LiveEventPublisher live;

    public AdminSettingsService(EventSettingsRepository repo, AuditService audit, LiveEventPublisher live) {
        this.repo = repo;
        this.audit = audit;
        this.live = live;
    }

    @Transactional
    public SettingsDto update(SettingsInput input, CurrentUser actor) {
        EventSettings settings = repo.findById((short) 1).orElseThrow(() -> ApiException.notFound("Event settings"));
        Map<String, String> errors = new LinkedHashMap<>();
        String name = input.eventName() == null ? "" : input.eventName().trim();
        if (name.length() < 2) errors.put("eventName", "Give the event a name.");
        range(errors, "warningThresholdMinutes", input.warningThresholdMinutes(), 1, 30, "Warning threshold");
        range(errors, "cleaningAutoClearSeconds", input.cleaningAutoClearSeconds(), 0, 900, "Cleaning delay");
        range(errors, "maxPauseMinutes", input.maxPauseMinutes(), 0, 30, "Pause budget");
        range(errors, "maxExtensionMinutes", input.maxExtensionMinutes(), 5, 120, "Extension cap");
        range(errors, "openingCashFloatPaise", input.openingCashFloatPaise(), 0, 10_000_000, "Opening float");
        if (!errors.isEmpty()) throw ApiException.validation(errors.values().iterator().next(), errors);

        Map<String, Object> before = snapshot(settings);
        settings.setEventName(name);
        settings.setWarningThresholdMinutes((short) input.warningThresholdMinutes());
        settings.setCleaningAutoClearSeconds((short) input.cleaningAutoClearSeconds());
        settings.setMaxPauseMinutes((short) input.maxPauseMinutes());
        settings.setAllowExtensions(input.allowExtensions());
        settings.setMaxExtensionMinutes((short) input.maxExtensionMinutes());
        settings.setOpeningCashFloatPaise(input.openingCashFloatPaise());
        repo.save(settings);

        // Only the fields that actually moved, so the log reads as a diff and not a dump.
        Map<String, Object> after = snapshot(settings);
        Map<String, Object> changedBefore = new LinkedHashMap<>();
        Map<String, Object> changedAfter = new LinkedHashMap<>();
        after.forEach((key, value) -> {
            if (!java.util.Objects.equals(before.get(key), value)) {
                changedBefore.put(key, before.get(key));
                changedAfter.put(key, value);
            }
        });
        if (!changedAfter.isEmpty()) {
            audit.record(actor.id(), "SETTINGS_UPDATED", "event_settings", 1L, "Event settings",
                    changedBefore, changedAfter);
        }
        live.publish(LiveEvent.Type.SETTINGS_UPDATED, Map.of());
        return SettingsService.toDto(settings);
    }

    private static void range(Map<String, String> errors, String field, int value, int lo, int hi, String label) {
        if (value < lo || value > hi) errors.put(field, "%s must be %d-%d.".formatted(label, lo, hi));
    }

    private static Map<String, Object> snapshot(EventSettings s) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("eventName", s.getEventName());
        map.put("warningThresholdMinutes", (int) s.getWarningThresholdMinutes());
        map.put("cleaningAutoClearSeconds", (int) s.getCleaningAutoClearSeconds());
        map.put("maxPauseMinutes", (int) s.getMaxPauseMinutes());
        map.put("allowExtensions", s.isAllowExtensions());
        map.put("maxExtensionMinutes", (int) s.getMaxExtensionMinutes());
        map.put("openingCashFloatPaise", s.getOpeningCashFloatPaise());
        return map;
    }
}

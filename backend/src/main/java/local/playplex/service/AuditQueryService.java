package local.playplex.service;

import local.playplex.api.dto.AdminDtos.AuditEntryDto;
import local.playplex.api.dto.TicketDtos.PageDto;
import local.playplex.domain.AuditLog;
import local.playplex.domain.Role;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import local.playplex.repo.AuditLogRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;

/**
 * "Why did PPX-0031 wait fifty minutes?" answered on Monday morning (docs/05 A6). Read-only
 * by construction: there is no endpoint that edits or deletes an audit row.
 */
@Service
public class AuditQueryService {

    private static final int PAGE_SIZE = 50;

    private final AuditLogRepository repo;
    private final SettingsService settings;
    private final ObjectMapper json;
    private final Clock clock;

    public AuditQueryService(AuditLogRepository repo, SettingsService settings, ObjectMapper json, Clock clock) {
        this.repo = repo;
        this.settings = settings;
        this.json = json;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public PageDto<AuditEntryDto> search(String action, Long userId, LocalDate from, LocalDate to, int page) {
        ZoneId zone = ZoneId.of(settings.get().getTimezone());
        EventDay today = EventDay.of(clock.instant(), settings.get().getTimezone());
        var window = EventDay.of(from == null ? today.date() : from, zone);
        var end = to == null ? window : EventDay.of(to, zone);

        Page<AuditLog> found = repo.search(blankToNull(action), userId, window.from(), end.to(),
                PageRequest.of(Math.max(0, page), PAGE_SIZE));
        return new PageDto<>(found.getContent().stream().map(this::toDto).toList(),
                found.getNumber(), PAGE_SIZE, found.getTotalElements(),
                Math.max(1, found.getTotalPages()));
    }

    private AuditEntryDto toDto(AuditLog a) {
        return new AuditEntryDto(a.getId(), a.getOccurredAt(),
                a.getActor() == null ? "System" : a.getActor().getFullName(),
                a.getActor() == null ? Role.ADMIN : a.getActor().getRole(),
                a.getAction(), a.getEntityType(), a.getEntityId(), a.getEntityLabel(),
                parse(a.getBeforeJson()), parse(a.getAfterJson()));
    }

    private Map<String, Object> parse(String raw) {
        if (raw == null || raw.isBlank()) return null;
        return json.readValue(raw, new TypeReference<Map<String, Object>>() { });
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}

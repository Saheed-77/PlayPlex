package local.playplex.api;

import jakarta.validation.Valid;
import local.playplex.api.dto.AdminDtos.AuditEntryDto;
import local.playplex.api.dto.AdminDtos.SettingsInput;
import local.playplex.api.dto.FloorDtos.SettingsDto;
import local.playplex.api.dto.TicketDtos.PageDto;
import local.playplex.security.CurrentUser;
import local.playplex.service.AdminSettingsService;
import local.playplex.service.AuditQueryService;
import local.playplex.service.SettingsService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;

/** Event settings and the audit trail — the two things admin reaches for when something looks wrong. */
@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasRole('ADMIN')")
public class AdminSettingsController {

    private final SettingsService settings;
    private final AdminSettingsService updates;
    private final AuditQueryService auditLog;

    public AdminSettingsController(SettingsService settings, AdminSettingsService updates,
                                   AuditQueryService auditLog) {
        this.settings = settings;
        this.updates = updates;
        this.auditLog = auditLog;
    }

    @GetMapping("/settings")
    public SettingsDto get() { return SettingsService.toDto(settings.get()); }

    @PutMapping("/settings")
    public SettingsDto update(@Valid @RequestBody SettingsInput input,
                              @AuthenticationPrincipal CurrentUser user) {
        return updates.update(input, user);
    }

    @GetMapping("/audit-log")
    public PageDto<AuditEntryDto> auditLog(
            @RequestParam(required = false) String action,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") int page) {
        return auditLog.search(action, userId, from, to, page);
    }
}

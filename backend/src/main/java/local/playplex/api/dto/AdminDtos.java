package local.playplex.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import local.playplex.domain.DeviceStatus;
import local.playplex.domain.Role;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Admin configuration shapes, matching frontend/src/types/api.ts. */
public class AdminDtos {

    // ── devices ──────────────────────────────────────────────────────────────
    public record CurrentSessionRef(List<String> ticketNos, Instant plannedEndAt) { }

    public record AdminDeviceDto(Long id, String code, String label, String locationNote,
                                 Long deviceTypeId, String deviceTypeCode, int capacity,
                                 DeviceStatus status, String statusReason, boolean active,
                                 CurrentSessionRef currentSession, double uptimePctToday,
                                 int sessionsToday) { }

    public record DeviceInput(@NotNull(message = "Pick a device type.") Long deviceTypeId,
                              String code, String label, String locationNote, int capacity) { }

    public record DeviceUpdate(String label, String locationNote, Integer capacity, Boolean active) { }

    public record SuggestedCode(String code) { }

    // ── device types ─────────────────────────────────────────────────────────
    public record DeviceTypeDto(Long id, String code, String name, String icon,
                                int defaultCapacity, int sortOrder, boolean active) { }

    public record DeviceTypeInput(String code, String name, String icon, int defaultCapacity) { }

    // ── plans ────────────────────────────────────────────────────────────────
    public record PlanDto(Long id, String name, int durationMinutes, int pricePaise, String description,
                          int sortOrder, boolean active, List<Long> deviceTypeIds, int seatsPerTicket,
                          int ticketsSold) { }

    public record PlanInput(@NotBlank(message = "Give the plan a name.") String name,
                            int durationMinutes, int pricePaise, String description,
                            List<Long> deviceTypeIds, Integer seatsPerTicket, Boolean active) { }

    public record ReorderRequest(List<Long> ids) { }

    // ── staff ────────────────────────────────────────────────────────────────
    public record StaffInput(@NotBlank String username, @NotBlank(message = "Enter their name.") String fullName,
                             @NotNull(message = "Pick a role.") Role role) { }

    public record StaffUpdate(String fullName, Role role, Boolean active) { }

    /** Shown once, read aloud, never stored in the clear. */
    public record TemporaryPassword(AuthDtos.UserDto user, String temporaryPassword) { }

    public record PasswordReset(String temporaryPassword) { }

    // ── settings ─────────────────────────────────────────────────────────────
    public record SettingsInput(@NotBlank(message = "Give the event a name.") String eventName,
                                int warningThresholdMinutes, int cleaningAutoClearSeconds,
                                int maxPauseMinutes, boolean allowExtensions, int maxExtensionMinutes,
                                int openingCashFloatPaise) { }

    // ── audit ────────────────────────────────────────────────────────────────
    public record AuditEntryDto(Long id, Instant occurredAt, String actorName, Role actorRole,
                                String action, String entityType, Long entityId, String entityLabel,
                                Map<String, Object> before, Map<String, Object> after) { }
}

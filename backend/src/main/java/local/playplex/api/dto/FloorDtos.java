package local.playplex.api.dto;

import local.playplex.domain.DeviceStatus;
import local.playplex.domain.PauseReason;
import local.playplex.domain.PaymentStatus;

import java.time.Instant;
import java.util.List;

/**
 * The composite read (docs/04 §3). Field names match frontend/src/types/api.ts exactly —
 * the UI is already written against this shape.
 *
 * Note what is absent: no remainingSeconds, no "OVERDUE" state. The client derives both
 * from plannedEndAt and its skew-corrected clock, so the server never ships a number that
 * goes stale the instant it is serialised.
 */
public class FloorDtos {

    public record SettingsDto(String eventName, int warningThresholdMinutes, int cleaningAutoClearSeconds,
                              int maxPauseMinutes, boolean allowExtensions, int maxExtensionMinutes,
                              int openingCashFloatPaise, String timezone) { }

    public record PlayerDto(Long ticketId, String ticketNo, String displayName, String planName,
                            int durationMinutes, int seatNo, PaymentStatus paymentStatus) { }

    public record SessionDto(Long id, Instant startedAt, Instant plannedEndAt, int extensionMinutesTotal,
                             Instant pausedAt, int pausedSecondsTotal, PauseReason pauseReason,
                             String startedByName, List<PlayerDto> players) { }

    public record NextUpDto(Long ticketId, String ticketNo, String displayName, String planName,
                            int waitingMinutes, int priority) { }

    public record DeviceDto(Long id, String code, String label, String locationNote, Long deviceTypeId,
                            String deviceTypeCode, int capacity, DeviceStatus status, String statusReason,
                            Instant statusChangedAt, SessionDto session, NextUpDto nextUp) { }

    public record TypeSummaryDto(Long id, String code, String name, String icon, int total, int available,
                                 int inUse, int cleaning, int outOfService, int queueLength,
                                 int estimatedWaitMinutes) { }

    public record SummaryDto(int totalDevices, int available, int inUse, int cleaning, int outOfService,
                             int queueLength, int estimatedWaitMinutes) { }

    public record FloorDto(Instant serverTime, SummaryDto summary, List<TypeSummaryDto> byDeviceType,
                           List<DeviceDto> devices, SettingsDto settings, int duesCount) { }
}

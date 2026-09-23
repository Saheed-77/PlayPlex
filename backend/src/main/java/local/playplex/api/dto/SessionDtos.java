package local.playplex.api.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import local.playplex.domain.EndReason;
import local.playplex.domain.SkipReason;

import java.time.Instant;
import java.util.List;

public class SessionDtos {

    /** ticketIds is 1..device.capacity — two entries for a PS5 duo. */
    public record StartSessionRequest(@NotNull(message = "Pick a device.") Long deviceId,
                                      @NotEmpty(message = "Pick at least one ticket.") List<Long> ticketIds,
                                      SkipReason skipReason) { }

    public record EndSessionRequest(@NotNull(message = "Pick a reason.") EndReason reason, String note) { }

    public record SessionSummaryDto(Long id, String deviceCode, String deviceTypeCode, Instant startedAt,
                                    Instant plannedEndAt, Instant endedAt, EndReason endReason,
                                    int extensionMinutesTotal, Instant pausedAt, int pausedSecondsTotal,
                                    List<String> playerNames, List<String> ticketNos, String startedByName) { }
}

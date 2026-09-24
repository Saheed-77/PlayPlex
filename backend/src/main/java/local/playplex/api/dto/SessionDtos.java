package local.playplex.api.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import local.playplex.domain.EndReason;
import local.playplex.domain.PauseReason;
import local.playplex.domain.SkipReason;

import java.time.Instant;
import java.util.List;

public class SessionDtos {

    /** ticketIds is 1..device.capacity — two entries for a PS5 duo. */
    public record StartSessionRequest(@NotNull(message = "Pick a device.") Long deviceId,
                                      @NotEmpty(message = "Pick at least one ticket.") List<Long> ticketIds,
                                      SkipReason skipReason) { }

    public record EndSessionRequest(@NotNull(message = "Pick a reason.") EndReason reason, String note) { }

    public record ExtendRequest(int minutes, boolean collectPayment) { }

    /** Technical reasons only: a pause costs everyone in the queue (docs/02 §8). */
    public record PauseRequest(@NotNull(message = "Pick what went wrong.") PauseReason reason, String note) { }

    public record LostTimeRequest(int minutes,
                                  @NotNull(message = "Pick what went wrong.") PauseReason reason,
                                  String note) { }

    public record NoteRequest(String note) { }

    public record BulkEndResponse(int ended) { }

    /** The five-line handover checklist from docs/02 §9, as data. */
    public record HandoverSummary(String userName, int sessionsStarted, List<RunningDto> running,
                                  List<RunningDto> overdue, List<DownDto> outOfService,
                                  List<DueDto> paymentDue) { }

    public record RunningDto(String deviceCode, Instant plannedEndAt, List<String> players) { }

    public record DownDto(String deviceCode, String reason, Instant since) { }

    public record DueDto(String ticketNo, String displayName, int amountDuePaise) { }

    public record SessionSummaryDto(Long id, String deviceCode, String deviceTypeCode, Instant startedAt,
                                    Instant plannedEndAt, Instant endedAt, EndReason endReason,
                                    int extensionMinutesTotal, Instant pausedAt, int pausedSecondsTotal,
                                    List<String> playerNames, List<String> ticketNos, String startedByName) { }
}

package local.playplex.api.dto;

import local.playplex.domain.PaymentMethod;

import java.time.Instant;
import java.util.List;

/**
 * Report shapes (docs/04 §10). Every number falls out of the schema — none of it needs
 * extra instrumentation, which is why the ledger and the session rows are shaped as they are.
 */
public class ReportDtos {

    public record RevenueBlock(int totalPaise, int cashPaise, int upiPaise, int refundsPaise,
                               int cashRefundsPaise, int waivedPaise, int outstandingDuesPaise) { }

    public record TypeBreakdown(String code, String name, int sessions, int revenuePaise,
                                double utilizationPct) { }

    public record SummaryReport(int registrations, int sessionsCompleted, int sessionsActive,
                                int noShows, int cancellations, RevenueBlock revenue,
                                int openingCashFloatPaise, double utilizationPct,
                                int medianWaitMinutes, double avgSessionMinutes, int overdueSessions,
                                int pausedMinutes, int pausedSessions, Instant peakHour,
                                int registrationsLastHour, List<TypeBreakdown> byDeviceType) { }

    public record MethodRow(PaymentMethod method, int amountPaise, int count) { }

    public record PlanRow(String planName, int amountPaise, int tickets) { }

    public record CollectorRow(String name, int amountPaise, int count) { }

    public record HourRow(Instant hour, int amountPaise, int sessions, int registrations) { }

    public record RevenueReport(List<MethodRow> byMethod, List<PlanRow> byPlan,
                                List<CollectorRow> byCollector, List<HourRow> hourly) { }

    public record DeviceUtilization(String code, String typeCode, int sessions, int minutesInUse,
                                    int minutesAvailable, double utilizationPct, int downMinutes,
                                    int pausedMinutes) { }

    public record TypeUtilization(String code, String name, int sessions, double utilizationPct) { }

    public record UtilizationReport(List<DeviceUtilization> byDevice, List<TypeUtilization> byType) { }

    public record WaitBucket(String bucket, int count) { }

    public record LongWait(String ticketNo, String name, int waitMinutes, int skipped) { }

    public record QueueReport(int medianWaitMinutes, int p90WaitMinutes, double noShowRatePct,
                              List<WaitBucket> distribution, List<LongWait> longestWaits) { }
}

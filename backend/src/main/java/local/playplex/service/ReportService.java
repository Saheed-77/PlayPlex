package local.playplex.service;

import local.playplex.api.dto.ReportDtos.*;
import local.playplex.api.dto.TicketDtos.PageDto;
import local.playplex.api.dto.TicketDtos.TicketDto;
import local.playplex.domain.*;
import local.playplex.repo.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.function.Function;

/**
 * Every number here falls out of rows that already had to exist: the payment ledger, the
 * session rows, the status log (docs/03 §6). Nothing is instrumented separately, so a report
 * can never disagree with the desk.
 *
 * The one subtlety is paused time. A station held for a crashed game was occupied but not
 * *played*, so those minutes are subtracted from utilisation and reported on their own —
 * otherwise a bad evening would look like a busy one.
 */
@Service
public class ReportService {

    private static final int PAGE_SIZE = 25;

    private final TicketRepository tickets;
    private final PaymentRepository payments;
    private final PlaySessionRepository sessions;
    private final PlaySessionPlayerRepository players;
    private final DeviceRepository devices;
    private final DeviceTypeRepository deviceTypes;
    private final DeviceStatusLogRepository statusLog;
    private final TicketService ticketService;
    private final SettingsService settings;
    private final Clock clock;

    public ReportService(TicketRepository tickets, PaymentRepository payments,
                         PlaySessionRepository sessions, PlaySessionPlayerRepository players,
                         DeviceRepository devices, DeviceTypeRepository deviceTypes,
                         DeviceStatusLogRepository statusLog, TicketService ticketService,
                         SettingsService settings, Clock clock) {
        this.tickets = tickets;
        this.payments = payments;
        this.sessions = sessions;
        this.players = players;
        this.devices = devices;
        this.deviceTypes = deviceTypes;
        this.statusLog = statusLog;
        this.ticketService = ticketService;
        this.settings = settings;
        this.clock = clock;
    }

    public ReportWindow window(java.time.LocalDate from, java.time.LocalDate to) {
        return ReportWindow.of(from, to, clock.instant(), settings.get().getTimezone());
    }

    // ── summary ──────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public SummaryReport summary(ReportWindow w) {
        Instant now = clock.instant();
        List<Ticket> created = tickets.findCreatedBetween(w.start(), w.end());
        List<Payment> paid = payments.findCollectedBetween(w.start(), w.end());
        List<PlaySession> ended = sessions.findEndedBetween(w.start(), w.end());
        List<PlaySession> started = sessions.findStartedBetween(w.start(), w.end());
        List<PlaySession> overlapping = sessions.findOverlapping(w.start(), w.end());

        List<Device> live = devices.findAllWithType().stream().filter(Device::isActive).toList();
        Map<Long, List<PlaySession>> byDevice = groupBy(overlapping, s -> s.getDevice().getId());
        Map<Long, Minutes> minutes = new HashMap<>();
        for (Device d : live) {
            minutes.put(d.getId(), deviceMinutes(d, byDevice.getOrDefault(d.getId(), List.of()), w, now));
        }

        double inUse = minutes.values().stream().mapToDouble(Minutes::played).sum();
        double available = minutes.values().stream().mapToDouble(Minutes::available).sum();

        List<Double> waits = tickets.findAssignedBetween(w.start(), w.end()).stream()
                .map(t -> minutesBetween(t.getQueuedAt(), t.getAssignedAt()))
                .toList();

        Map<Long, Long> typeOfTicket = ticketTypeIds();
        Map<Long, Integer> revenueByType = new HashMap<>();
        for (Payment p : paid) {
            Long typeId = typeOfTicket.get(p.getTicket().getId());
            if (typeId != null) revenueByType.merge(typeId, p.getAmountPaise(), Integer::sum);
        }

        List<TypeBreakdown> byType = new ArrayList<>();
        for (DeviceType type : deviceTypes.findAll()) {
            List<Device> mine = live.stream()
                    .filter(d -> d.getDeviceType().getId().equals(type.getId())).toList();
            double typeInUse = mine.stream().mapToDouble(d -> minutes.get(d.getId()).played()).sum();
            double typeAvailable = mine.stream().mapToDouble(d -> minutes.get(d.getId()).available()).sum();
            int typeSessions = mine.stream().mapToInt(d -> minutes.get(d.getId()).sessions()).sum();
            byType.add(new TypeBreakdown(type.getCode(), type.getName(), typeSessions,
                    revenueByType.getOrDefault(type.getId(), 0), pct(typeInUse, typeAvailable)));
        }

        int waived = created.stream()
                .filter(t -> t.getPaymentStatus() == PaymentStatus.WAIVED)
                .mapToInt(Ticket::getPricePaiseSnapshot).sum();
        int outstanding = tickets.findAll().stream()
                .filter(t -> t.getPaymentStatus() == PaymentStatus.PAYMENT_DUE)
                .mapToInt(Ticket::getAmountDuePaise).sum();

        RevenueBlock revenue = new RevenueBlock(
                sum(paid), positive(paid, PaymentMethod.CASH), positive(paid, PaymentMethod.UPI),
                paid.stream().filter(p -> p.getAmountPaise() < 0).mapToInt(Payment::getAmountPaise).sum(),
                paid.stream().filter(p -> p.getAmountPaise() < 0 && p.getMethod() == PaymentMethod.CASH)
                        .mapToInt(Payment::getAmountPaise).sum(),
                waived, outstanding);

        double avgSession = ended.isEmpty() ? 0 : round1(ended.stream()
                .mapToDouble(s -> minutesBetween(s.getStartedAt(), s.getEndedAt())).average().orElse(0));
        int overdue = (int) started.stream()
                .filter(s -> Duration.between(s.getPlannedEndAt(),
                        s.getEndedAt() == null ? now : s.getEndedAt()).toMinutes() > 5)
                .count();
        double pausedMinutes = minutes.values().stream().mapToDouble(Minutes::paused).sum();
        int pausedSessions = (int) overlapping.stream()
                .filter(s -> s.getPausedTotalSeconds() > 0 || s.getPausedAt() != null)
                .count();

        return new SummaryReport(
                created.size(), ended.size(), (int) sessions.findActive().size(),
                (int) created.stream().filter(t -> t.getStatus() == TicketStatus.NO_SHOW).count(),
                (int) created.stream().filter(t -> t.getStatus() == TicketStatus.CANCELLED).count(),
                revenue, settings.get().getOpeningCashFloatPaise(), pct(inUse, available),
                (int) Math.round(median(waits)), avgSession, overdue,
                (int) Math.round(pausedMinutes), pausedSessions, peakHour(started),
                (int) tickets.findAll().stream()
                        .filter(t -> t.getCreatedAt().isAfter(now.minus(1, ChronoUnit.HOURS))).count(),
                byType);
    }

    // ── revenue ──────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public RevenueReport revenue(ReportWindow w) {
        List<Payment> paid = payments.findCollectedBetween(w.start(), w.end());

        List<MethodRow> byMethod = Arrays.stream(PaymentMethod.values())
                .map(method -> {
                    List<Payment> rows = paid.stream().filter(p -> p.getMethod() == method).toList();
                    return new MethodRow(method, sum(rows), rows.size());
                })
                .toList();

        Map<String, List<Payment>> byPlanName = groupBy(paid, p -> p.getTicket().getPlanNameSnapshot());
        List<PlanRow> byPlan = byPlanName.entrySet().stream()
                .map(e -> new PlanRow(e.getKey(), sum(e.getValue()),
                        (int) e.getValue().stream().map(p -> p.getTicket().getId()).distinct().count()))
                .sorted(Comparator.comparingInt(PlanRow::amountPaise).reversed())
                .toList();

        Map<String, List<Payment>> byPerson = groupBy(paid, p -> p.getCollectedBy().getFullName());
        List<CollectorRow> byCollector = byPerson.entrySet().stream()
                .map(e -> new CollectorRow(e.getKey(), sum(e.getValue()), e.getValue().size()))
                .sorted(Comparator.comparingInt(CollectorRow::amountPaise).reversed())
                .toList();

        // The chart starts when the evening did, not at midnight: empty leading hours are noise.
        Instant firstActivity = paid.stream().map(Payment::getCollectedAt).min(Instant::compareTo)
                .orElse(w.start());
        Instant firstHour = firstActivity.truncatedTo(ChronoUnit.HOURS);

        List<PlaySession> started = sessions.findStartedBetween(w.start(), w.end());
        List<Ticket> created = tickets.findCreatedBetween(w.start(), w.end());
        List<HourRow> hourly = new ArrayList<>();
        for (Instant hour = firstHour; hour.isBefore(w.end()); hour = hour.plus(1, ChronoUnit.HOURS)) {
            Instant next = hour.plus(1, ChronoUnit.HOURS);
            Instant h = hour;
            hourly.add(new HourRow(hour,
                    paid.stream().filter(p -> within(p.getCollectedAt(), h, next))
                            .mapToInt(Payment::getAmountPaise).sum(),
                    (int) started.stream().filter(s -> within(s.getStartedAt(), h, next)).count(),
                    (int) created.stream().filter(t -> within(t.getCreatedAt(), h, next)).count()));
        }
        return new RevenueReport(byMethod, byPlan, byCollector, hourly);
    }

    // ── utilization ──────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public UtilizationReport utilization(ReportWindow w) {
        Instant now = clock.instant();
        Map<Long, List<PlaySession>> byDevice = groupBy(sessions.findOverlapping(w.start(), w.end()),
                s -> s.getDevice().getId());

        List<DeviceUtilization> rows = devices.findAllWithType().stream()
                .filter(Device::isActive)
                .sorted(Comparator.comparing(Device::getCode))
                .map(d -> {
                    Minutes m = deviceMinutes(d, byDevice.getOrDefault(d.getId(), List.of()), w, now);
                    return new DeviceUtilization(d.getCode(), d.getDeviceType().getCode(), m.sessions(),
                            (int) Math.round(m.played()), (int) Math.round(m.available()),
                            pct(m.played(), m.available()), (int) Math.round(m.down()),
                            (int) Math.round(m.paused()));
                })
                .toList();

        List<TypeUtilization> byType = deviceTypes.findAll().stream()
                .map(type -> {
                    List<DeviceUtilization> mine = rows.stream()
                            .filter(r -> r.typeCode().equals(type.getCode())).toList();
                    return new TypeUtilization(type.getCode(), type.getName(),
                            mine.stream().mapToInt(DeviceUtilization::sessions).sum(),
                            pct(mine.stream().mapToInt(DeviceUtilization::minutesInUse).sum(),
                                    mine.stream().mapToInt(DeviceUtilization::minutesAvailable).sum()));
                })
                .toList();
        return new UtilizationReport(rows, byType);
    }

    // ── queue ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public QueueReport queue(ReportWindow w) {
        List<Ticket> assigned = tickets.findAssignedBetween(w.start(), w.end());
        List<Double> waits = assigned.stream()
                .map(t -> minutesBetween(t.getQueuedAt(), t.getAssignedAt()))
                .toList();
        List<Ticket> created = tickets.findCreatedBetween(w.start(), w.end()).stream()
                .filter(t -> t.getStatus() != TicketStatus.CANCELLED)
                .toList();

        int[][] buckets = { {0, 5}, {5, 10}, {10, 15}, {15, 20}, {20, 30}, {30, Integer.MAX_VALUE} };
        String[] labels = { "0-5", "5-10", "10-15", "15-20", "20-30", "30+" };
        List<WaitBucket> distribution = new ArrayList<>();
        for (int i = 0; i < buckets.length; i++) {
            int lo = buckets[i][0];
            int hi = buckets[i][1];
            distribution.add(new WaitBucket(labels[i],
                    (int) waits.stream().filter(x -> x >= lo && x < hi).count()));
        }

        List<LongWait> longest = assigned.stream()
                .map(t -> new LongWait(t.getTicketNo(), t.getStudent().getFullName(),
                        (int) Math.round(minutesBetween(t.getQueuedAt(), t.getAssignedAt())),
                        t.getSkippedCount()))
                .sorted(Comparator.comparingInt(LongWait::waitMinutes).reversed())
                .limit(8)
                .toList();

        long noShows = created.stream()
                .filter(t -> t.getStatus() == TicketStatus.NO_SHOW || t.getNoShowCount() > 0).count();
        return new QueueReport((int) Math.round(median(waits)), (int) Math.round(percentile(waits, 90)),
                pct(noShows, created.size()), distribution, longest);
    }

    // ── students ─────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public PageDto<TicketDto> students(ReportWindow w, String query, int page) {
        Instant now = clock.instant();
        String needle = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        List<Ticket> rows = tickets.findCreatedBetween(w.start(), w.end()).stream()
                .filter(t -> needle.isEmpty()
                        || t.getTicketNo().toLowerCase(Locale.ROOT).contains(needle)
                        || t.getStudent().getFullName().toLowerCase(Locale.ROOT).contains(needle)
                        || t.getStudent().getPhone().contains(needle)
                        || (t.getStudent().getRollNo() != null
                            && t.getStudent().getRollNo().toLowerCase(Locale.ROOT).contains(needle)))
                .sorted(Comparator.comparing(Ticket::getCreatedAt).reversed())
                .toList();

        int fromIndex = Math.min(Math.max(0, page) * PAGE_SIZE, rows.size());
        int toIndex = Math.min(fromIndex + PAGE_SIZE, rows.size());
        return new PageDto<>(rows.subList(fromIndex, toIndex).stream()
                .map(t -> ticketService.toDto(t, now, false)).toList(),
                page, PAGE_SIZE, rows.size(),
                Math.max(1, (int) Math.ceil(rows.size() / (double) PAGE_SIZE)));
    }

    // ── shared maths ─────────────────────────────────────────────────────────

    /** Played, available, down and paused minutes for one station over one window. */
    record Minutes(double played, double available, double down, double paused, int sessions) { }

    private Minutes deviceMinutes(Device device, List<PlaySession> mine, ReportWindow w, Instant now) {
        Instant start = w.startOrAfter(device.getCreatedAt());
        Instant end = w.end();
        if (!end.isAfter(start)) return new Minutes(0, 0, 0, 0, 0);

        double inUse = 0;
        double paused = 0;
        int count = 0;
        for (PlaySession s : mine) {
            Instant a = s.getStartedAt().isAfter(start) ? s.getStartedAt() : start;
            Instant b = s.getEndedAt() == null || s.getEndedAt().isAfter(end) ? end : s.getEndedAt();
            if (b.isAfter(a)) {
                inUse += minutesBetween(a, b);
                paused += s.getPausedTotalSeconds() / 60.0;
                if (s.getPausedAt() != null) {
                    // Still held right now: count the part of the hold inside the window.
                    Instant heldFrom = s.getPausedAt().isAfter(start) ? s.getPausedAt() : start;
                    if (end.isAfter(heldFrom)) paused += minutesBetween(heldFrom, end);
                }
            }
            if (w.contains(s.getStartedAt())) count++;
        }

        double down = 0;
        Instant since = null;
        for (DeviceStatusLog log : statusLog.findByDevice(device.getId())) {
            if (log.getToStatus() == DeviceStatus.OUT_OF_SERVICE && since == null) {
                since = log.getChangedAt().isAfter(start) ? log.getChangedAt() : start;
            } else if (log.getToStatus() != DeviceStatus.OUT_OF_SERVICE && since != null) {
                Instant until = log.getChangedAt().isBefore(end) ? log.getChangedAt() : end;
                if (until.isAfter(since)) down += minutesBetween(since, until);
                since = null;
            }
        }
        if (since != null && end.isAfter(since)) down += minutesBetween(since, end);

        double window = minutesBetween(start, end);
        double available = Math.max(0, window - down);
        double played = Math.max(0, Math.min(inUse, available) - paused);
        return new Minutes(played, available, down, paused, count);
    }

    /** Where a ticket's money belongs: the station it played on, else the one it asked for. */
    private Map<Long, Long> ticketTypeIds() {
        Map<Long, Long> map = new HashMap<>();
        for (Ticket t : tickets.findAll()) {
            if (t.getPreferredDeviceType() != null) map.put(t.getId(), t.getPreferredDeviceType().getId());
        }
        for (PlaySessionPlayer p : players.findAllWithDevice()) {
            map.put(p.getTicket().getId(), p.getSession().getDevice().getDeviceType().getId());
        }
        return map;
    }

    private static Instant peakHour(List<PlaySession> started) {
        Map<Instant, Long> perHour = new HashMap<>();
        for (PlaySession s : started) {
            perHour.merge(s.getStartedAt().truncatedTo(ChronoUnit.HOURS), 1L, Long::sum);
        }
        return perHour.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse(null);
    }

    private static <T, K> Map<K, List<T>> groupBy(List<T> rows, Function<T, K> key) {
        Map<K, List<T>> map = new LinkedHashMap<>();
        for (T row : rows) map.computeIfAbsent(key.apply(row), k -> new ArrayList<>()).add(row);
        return map;
    }

    private static boolean within(Instant at, Instant from, Instant to) {
        return at != null && !at.isBefore(from) && at.isBefore(to);
    }

    private static int sum(List<Payment> rows) {
        return rows.stream().mapToInt(Payment::getAmountPaise).sum();
    }

    private static int positive(List<Payment> rows, PaymentMethod method) {
        return rows.stream().filter(p -> p.getMethod() == method && p.getAmountPaise() > 0)
                .mapToInt(Payment::getAmountPaise).sum();
    }

    static double minutesBetween(Instant from, Instant to) {
        return Duration.between(from, to).toMillis() / 60000.0;
    }

    static double median(List<Double> values) {
        if (values.isEmpty()) return 0;
        List<Double> sorted = values.stream().sorted().toList();
        int mid = sorted.size() / 2;
        return sorted.size() % 2 == 1 ? sorted.get(mid)
                : Math.round((sorted.get(mid - 1) + sorted.get(mid)) / 2);
    }

    static double percentile(List<Double> values, int p) {
        if (values.isEmpty()) return 0;
        List<Double> sorted = values.stream().sorted().toList();
        return sorted.get(Math.min(sorted.size() - 1, (int) Math.floor(p / 100.0 * sorted.size())));
    }

    static double pct(double a, double b) {
        return b > 0 ? Math.round(a / b * 1000) / 10.0 : 0;
    }

    private static double round1(double value) {
        return Math.round(value * 10) / 10.0;
    }
}

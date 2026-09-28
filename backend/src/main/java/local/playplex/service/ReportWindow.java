package local.playplex.service;

import local.playplex.error.ApiException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;

/**
 * A report range in the event's own timezone, clamped so "today" never measures itself
 * against hours that have not happened yet.
 */
public record ReportWindow(LocalDate from, LocalDate to, Instant start, Instant end) {

    public static ReportWindow of(LocalDate from, LocalDate to, Instant now, String timezone) {
        ZoneId zone = ZoneId.of(timezone);
        LocalDate today = LocalDate.ofInstant(now, zone);
        LocalDate lo = from == null ? today : from;
        LocalDate hi = to == null ? today : to;
        if (hi.isBefore(lo)) {
            throw ApiException.validation("Pick a valid date range.", Map.of("from", "Pick a valid date range."));
        }
        Instant start = EventDay.of(lo, zone).from();
        Instant rawEnd = EventDay.of(hi, zone).to();
        return new ReportWindow(lo, hi, start, rawEnd.isBefore(now) ? rawEnd : now);
    }

    public boolean contains(Instant at) {
        return at != null && !at.isBefore(start) && at.isBefore(end);
    }

    /** The later of the window's start and some other instant — a device born mid-event, say. */
    public Instant startOrAfter(Instant other) {
        return other != null && other.isAfter(start) ? other : start;
    }
}

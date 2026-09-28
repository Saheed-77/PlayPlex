package local.playplex.service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * "Today" is the event's local day, not UTC midnight — a session that starts at 23:50 IST
 * belongs to that day's numbers even though UTC has already rolled over (docs/03 §5).
 */
public record EventDay(LocalDate date, ZoneId zone, Instant from, Instant to) {

    public static EventDay of(Instant now, String timezone) {
        ZoneId zone = ZoneId.of(timezone);
        return of(LocalDate.ofInstant(now, zone), zone);
    }

    public static EventDay of(LocalDate date, ZoneId zone) {
        return new EventDay(date, zone, date.atStartOfDay(zone).toInstant(),
                date.plusDays(1).atStartOfDay(zone).toInstant());
    }

    /** Clamped so a half-finished day is not measured against 24 hours it never had. */
    public Instant endOrNow(Instant now) {
        return now.isBefore(to) ? now : to;
    }

    public boolean contains(Instant at) {
        return at != null && !at.isBefore(from) && at.isBefore(to);
    }
}

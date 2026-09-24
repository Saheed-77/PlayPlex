package local.playplex.live;

import java.util.Map;

/**
 * The live update vocabulary (docs/04 §11). Ten event types, and every one of them is a
 * *hint* rather than state: it carries enough for a client to patch its view, and anything
 * ambiguous makes the client refetch /api/floor. Never try to rebuild full state from a
 * stream of deltas — one missed event and every board is silently wrong.
 */
public record LiveEvent(Type type, Map<String, Object> data) {

    public enum Type {
        DEVICE_UPDATED("device.updated"),
        SESSION_STARTED("session.started"),
        SESSION_EXTENDED("session.extended"),
        SESSION_PAUSED("session.paused"),
        SESSION_RESUMED("session.resumed"),
        SESSION_OVERDUE("session.overdue"),
        SESSION_ENDED("session.ended"),
        QUEUE_UPDATED("queue.updated"),
        TICKET_FLAGGED("ticket.flagged"),
        SETTINGS_UPDATED("settings.updated");

        private final String wireName;

        Type(String wireName) { this.wireName = wireName; }

        /** What the browser's EventSource listens for. */
        public String wireName() { return wireName; }
    }

    public static LiveEvent of(Type type, Map<String, Object> data) {
        return new LiveEvent(type, data == null ? Map.of() : data);
    }
}

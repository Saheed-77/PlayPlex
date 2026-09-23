package local.playplex.domain;

// Stored as VARCHAR with a CHECK constraint and mapped with EnumType.STRING,
// never ORDINAL: inserting a value in the middle would silently reinterpret history.
public enum TicketStatus {
    QUEUED,
    ASSIGNED,
    COMPLETED,
    NO_SHOW,
    CANCELLED
}

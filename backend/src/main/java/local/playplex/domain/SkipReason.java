package local.playplex.domain;

// Stored as VARCHAR with a CHECK constraint and mapped with EnumType.STRING,
// never ORDINAL: inserting a value in the middle would silently reinterpret history.
public enum SkipReason {
    NOT_PRESENT,
    WANTS_DIFFERENT_DEVICE,
    OTHER
}

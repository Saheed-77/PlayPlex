package local.playplex.domain;

// Stored as VARCHAR with a CHECK constraint and mapped with EnumType.STRING,
// never ORDINAL: inserting a value in the middle would silently reinterpret history.
public enum DeviceStatus {
    AVAILABLE,
    IN_USE,
    CLEANING,
    OUT_OF_SERVICE
}

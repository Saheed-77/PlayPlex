package local.playplex.domain;

// Stored as VARCHAR with a CHECK constraint and mapped with EnumType.STRING,
// never ORDINAL: inserting a value in the middle would silently reinterpret history.
/** Technical faults only — a pause costs everyone in the queue (docs/02 §8). */
public enum PauseReason {
    GAME_CRASH,
    PERIPHERAL,
    POWER,
    NETWORK,
    OTHER
}

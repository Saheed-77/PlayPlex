package local.playplex.domain;

// Stored as VARCHAR with a CHECK constraint and mapped with EnumType.STRING,
// never ORDINAL: inserting a value in the middle would silently reinterpret history.
/** VOLUNTEER subset RECEPTION subset ADMIN in capability (docs/01 §4). */
public enum Role {
    ADMIN,
    RECEPTION,
    VOLUNTEER
}

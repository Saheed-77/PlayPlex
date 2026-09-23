package local.playplex.domain;

// Stored as VARCHAR with a CHECK constraint and mapped with EnumType.STRING,
// never ORDINAL: inserting a value in the middle would silently reinterpret history.
/** REFUND_DUE: a tech issue owes money back until reception settles it. */
public enum PaymentStatus {
    PAID,
    PAYMENT_DUE,
    REFUND_DUE,
    WAIVED,
    REFUNDED
}

package local.playplex.error;

import org.springframework.http.HttpStatus;

/**
 * The stable, machine-readable error vocabulary (docs/04 §1). The UI maps these to
 * friendly messages, so the strings are part of the contract: never rename one casually.
 */
public enum ErrorCode {
    VALIDATION_FAILED(HttpStatus.BAD_REQUEST),
    NOT_AUTHENTICATED(HttpStatus.UNAUTHORIZED),
    TOKEN_EXPIRED(HttpStatus.UNAUTHORIZED),
    INSUFFICIENT_ROLE(HttpStatus.FORBIDDEN),
    NOT_FOUND(HttpStatus.NOT_FOUND),
    DEVICE_NOT_AVAILABLE(HttpStatus.CONFLICT),
    TICKET_NOT_QUEUED(HttpStatus.CONFLICT),
    INVALID_TRANSITION(HttpStatus.CONFLICT),
    SESSION_ALREADY_ENDED(HttpStatus.CONFLICT),
    DUPLICATE_PHONE(HttpStatus.CONFLICT),
    CAPACITY_EXCEEDED(HttpStatus.CONFLICT),
    BUSINESS_RULE_VIOLATED(HttpStatus.UNPROCESSABLE_ENTITY),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR);

    private final HttpStatus status;

    ErrorCode(HttpStatus status) { this.status = status; }

    public HttpStatus status() { return status; }
}

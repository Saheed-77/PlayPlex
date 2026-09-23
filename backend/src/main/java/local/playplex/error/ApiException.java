package local.playplex.error;

import java.util.Map;

/** Carries a stable code and a message that is always safe to show a user. */
public class ApiException extends RuntimeException {
    private final ErrorCode code;
    private final Map<String, String> fieldErrors;

    public ApiException(ErrorCode code, String detail) { this(code, detail, Map.of()); }

    public ApiException(ErrorCode code, String detail, Map<String, String> fieldErrors) {
        super(detail);
        this.code = code;
        this.fieldErrors = fieldErrors;
    }

    public ErrorCode code() { return code; }

    public Map<String, String> fieldErrors() { return fieldErrors; }

    // Shorthands for the cases the services raise constantly.
    public static ApiException notFound(String what) {
        return new ApiException(ErrorCode.NOT_FOUND, what + " not found.");
    }

    public static ApiException validation(String detail, Map<String, String> fields) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, detail, fields);
    }

    public static ApiException conflict(ErrorCode code, String detail) {
        return new ApiException(code, detail);
    }

    public static ApiException rule(String detail) {
        return new ApiException(ErrorCode.BUSINESS_RULE_VIOLATED, detail);
    }
}

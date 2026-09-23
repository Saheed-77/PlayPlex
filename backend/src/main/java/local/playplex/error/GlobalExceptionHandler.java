package local.playplex.error;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Every error leaves as RFC 7807 Problem Details with a stable `code` (docs/04 §1).
 * `detail` is safe to show a user; stack traces and SQL go to the log, never the response.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ProblemDetail onApi(ApiException ex, HttpServletRequest request) {
        return problem(ex.code(), ex.getMessage(), ex.fieldErrors(), request);
    }

    /** Bean-validation failures become one VALIDATION_FAILED with a field map. */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail onInvalid(MethodArgumentNotValidException ex, HttpServletRequest request) {
        Map<String, String> fields = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors()
                .forEach(e -> fields.putIfAbsent(e.getField(), e.getDefaultMessage()));
        String detail = fields.values().stream().findFirst().orElse("Some fields need attention.");
        return problem(ErrorCode.VALIDATION_FAILED, detail, fields, request);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ProblemDetail onUnreadable(HttpMessageNotReadableException ex, HttpServletRequest request) {
        return problem(ErrorCode.VALIDATION_FAILED, "The request body could not be read.", Map.of(), request);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ProblemDetail onDenied(AccessDeniedException ex, HttpServletRequest request) {
        boolean anonymous = SecurityContextHolder.getContext().getAuthentication() == null
                || !SecurityContextHolder.getContext().getAuthentication().isAuthenticated();
        return anonymous
                ? problem(ErrorCode.NOT_AUTHENTICATED, "Please sign in.", Map.of(), request)
                : problem(ErrorCode.INSUFFICIENT_ROLE, "Your role can't do that.", Map.of(), request);
    }

    @ExceptionHandler(Exception.class)
    public ProblemDetail onUnexpected(Exception ex, HttpServletRequest request) {
        log.error("Unhandled exception on {} {}", request.getMethod(), request.getRequestURI(), ex);
        return problem(ErrorCode.INTERNAL_ERROR, "Something went wrong on the server. Try again.",
                Map.of(), request);
    }

    private ProblemDetail problem(ErrorCode code, String detail, Map<String, String> fields,
                                  HttpServletRequest request) {
        HttpStatus status = code.status();
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(status, detail);
        pd.setTitle(title(code));
        pd.setType(URI.create("https://playplex.local/errors/" + code.name().toLowerCase().replace('_', '-')));
        pd.setInstance(URI.create(request.getRequestURI()));
        pd.setProperty("code", code.name());
        if (!fields.isEmpty()) pd.setProperty("errors", fields);
        return pd;
    }

    private String title(ErrorCode code) {
        String words = code.name().toLowerCase().replace('_', ' ');
        return Character.toUpperCase(words.charAt(0)) + words.substring(1);
    }
}

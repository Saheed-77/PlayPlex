package local.playplex.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import local.playplex.error.ErrorCode;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * Security rejections happen before any controller, so they never reach the
 * @RestControllerAdvice. Without this, the UI gets an empty 401 body and can't tell
 * "signed out" from "wrong role" — both of which it handles differently.
 *
 * The payload is written by hand because it is two fixed shapes; that keeps this off the
 * Jackson upgrade path entirely.
 */
@Component
public class RestAuthErrorHandler implements AuthenticationEntryPoint, AccessDeniedHandler {

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
                         AuthenticationException ex) throws IOException {
        write(request, response, ErrorCode.NOT_AUTHENTICATED, "Please sign in.");
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
                       AccessDeniedException ex) throws IOException {
        write(request, response, ErrorCode.INSUFFICIENT_ROLE, "Your role can't do that.");
    }

    private void write(HttpServletRequest request, HttpServletResponse response,
                       ErrorCode code, String detail) throws IOException {
        response.setStatus(code.status().value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        String slug = code.name().toLowerCase().replace('_', '-');
        String title = code.status().getReasonPhrase();
        response.getWriter().write("""
                {"type":"https://playplex.local/errors/%s","title":"%s","status":%d,\
                "detail":"%s","code":"%s","instance":"%s"}"""
                .formatted(slug, title, code.status().value(), detail, code.name(),
                        escape(request.getRequestURI())));
    }

    private String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}

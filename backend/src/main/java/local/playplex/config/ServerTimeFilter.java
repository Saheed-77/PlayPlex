package local.playplex.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Clock;

/**
 * Stamps every response with the server's UTC time. The frontend reads it once per
 * response to maintain its clock-skew offset, which is what keeps countdowns correct on a
 * tablet whose clock is ten minutes fast (docs/04 §1, docs/02 §4.1).
 */
@Component
@Order(1)
public class ServerTimeFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Server-Time";

    private final Clock clock;

    public ServerTimeFilter(Clock clock) { this.clock = clock; }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        response.setHeader(HEADER, clock.instant().toString());
        chain.doFilter(request, response);
    }
}

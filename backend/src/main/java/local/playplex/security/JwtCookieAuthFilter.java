package local.playplex.security;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import local.playplex.config.AppProperties;
import local.playplex.domain.Role;
import local.playplex.repo.StaffUserRepository;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/** Reads the session cookie and populates the security context. */
@Component
public class JwtCookieAuthFilter extends OncePerRequestFilter {

    private final JwtService jwt;
    private final AppProperties props;
    private final StaffUserRepository users;

    public JwtCookieAuthFilter(JwtService jwt, AppProperties props, StaffUserRepository users) {
        this.jwt = jwt;
        this.props = props;
        this.users = users;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String token = readCookie(request, props.getJwt().getCookieName());
        Claims claims = token == null ? null : jwt.parse(token);
        if (claims != null && SecurityContextHolder.getContext().getAuthentication() == null) {
            Long id = Long.valueOf(claims.getSubject());
            // A deactivated account's token must stop working immediately (docs/07 task 4.4).
            users.findById(id).filter(u -> u.isActive()).ifPresent(user -> {
                var principal = new CurrentUser(user.getId(), user.getUsername(), user.getRole());
                var authorities = List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name()));
                var auth = new UsernamePasswordAuthenticationToken(principal, null, authorities);
                SecurityContextHolder.getContext().setAuthentication(auth);
            });
        }
        chain.doFilter(request, response);
    }

    private String readCookie(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) {
            if (name.equals(c.getName())) return c.getValue();
        }
        return null;
    }

    /** Roles are not hierarchical by accident: ADMIN can do everything, the others differ. */
    public static boolean isAdmin(Role role) { return role == Role.ADMIN; }
}

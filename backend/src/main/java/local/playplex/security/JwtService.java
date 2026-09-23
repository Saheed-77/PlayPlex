package local.playplex.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import local.playplex.config.AppProperties;
import local.playplex.domain.StaffUser;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.Date;

/** Stateless auth: a signed token in an HttpOnly cookie, no server-side session store. */
@Service
public class JwtService {

    private final AppProperties props;
    private final Clock clock;
    private final SecretKey key;

    public JwtService(AppProperties props, Clock clock) {
        this.props = props;
        this.clock = clock;
        this.key = Keys.hmacShaKeyFor(props.getJwt().getSecret().getBytes(StandardCharsets.UTF_8));
    }

    public String issue(StaffUser user) {
        var now = clock.instant();
        return Jwts.builder()
                .subject(String.valueOf(user.getId()))
                .claim("username", user.getUsername())
                .claim("role", user.getRole().name())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(Duration.ofHours(props.getJwt().getTtlHours()))))
                .signWith(key)
                .compact();
    }

    /** Returns the claims, or null when the token is missing, tampered with or expired. */
    public Claims parse(String token) {
        try {
            return Jwts.parser().verifyWith(key).clock(() -> Date.from(clock.instant()))
                    .build().parseSignedClaims(token).getPayload();
        } catch (JwtException | IllegalArgumentException ex) {
            return null;
        }
    }

    public Duration ttl() { return Duration.ofHours(props.getJwt().getTtlHours()); }
}

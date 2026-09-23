package local.playplex.api;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import local.playplex.api.dto.AuthDtos.AuthResponse;
import local.playplex.api.dto.AuthDtos.ChangePasswordRequest;
import local.playplex.api.dto.AuthDtos.LoginRequest;
import local.playplex.api.dto.AuthDtos.UserDto;
import local.playplex.config.AppProperties;
import local.playplex.domain.StaffUser;
import local.playplex.error.ApiException;
import local.playplex.error.ErrorCode;
import local.playplex.repo.StaffUserRepository;
import local.playplex.security.CurrentUser;
import local.playplex.security.JwtService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Clock;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final StaffUserRepository users;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final AppProperties props;
    private final Clock clock;

    public AuthController(StaffUserRepository users, PasswordEncoder encoder, JwtService jwt,
                          AppProperties props, Clock clock) {
        this.users = users;
        this.encoder = encoder;
        this.jwt = jwt;
        this.props = props;
        this.clock = clock;
    }

    @PostMapping("/login")
    @Transactional
    public AuthResponse login(@Valid @RequestBody LoginRequest request, HttpServletResponse response) {
        StaffUser user = users.findByUsername(request.username().trim().toLowerCase())
                // One message for both cases: never reveal which usernames exist.
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_AUTHENTICATED, "Wrong username or password."));
        if (!encoder.matches(request.password(), user.getPasswordHash())) {
            throw new ApiException(ErrorCode.NOT_AUTHENTICATED, "Wrong username or password.");
        }
        if (!user.isActive()) {
            throw new ApiException(ErrorCode.NOT_AUTHENTICATED, "This account has been deactivated. Ask the event lead.");
        }
        user.setLastLoginAt(clock.instant());
        setSessionCookie(response, jwt.issue(user), jwt.ttl().toSeconds());
        return new AuthResponse(UserDto.of(user), clock.instant());
    }

    @PostMapping("/logout")
    public void logout(HttpServletResponse response) {
        setSessionCookie(response, "", 0);
    }

    @GetMapping("/me")
    public AuthResponse me(@AuthenticationPrincipal CurrentUser principal) {
        StaffUser user = users.findById(principal.id()).orElseThrow(() -> ApiException.notFound("User"));
        return new AuthResponse(UserDto.of(user), clock.instant());
    }

    @PostMapping("/change-password")
    @Transactional
    public UserDto changePassword(@AuthenticationPrincipal CurrentUser principal,
                                  @Valid @RequestBody ChangePasswordRequest request) {
        StaffUser user = users.findById(principal.id()).orElseThrow(() -> ApiException.notFound("User"));
        if (!encoder.matches(request.currentPassword(), user.getPasswordHash())) {
            throw ApiException.validation("Current password is wrong.",
                    Map.of("currentPassword", "Current password is wrong."));
        }
        if (encoder.matches(request.newPassword(), user.getPasswordHash())) {
            throw ApiException.validation("Pick a password you have not used here.",
                    Map.of("newPassword", "Must differ from the current password."));
        }
        user.setPasswordHash(encoder.encode(request.newPassword()));
        user.setMustChangePassword(false);
        return UserDto.of(user);
    }

    /** HttpOnly + SameSite=Lax: unreadable from JavaScript, and not sent cross-site. */
    private void setSessionCookie(HttpServletResponse response, String value, long maxAgeSeconds) {
        ResponseCookie cookie = ResponseCookie.from(props.getJwt().getCookieName(), value)
                .httpOnly(true)
                .secure(props.getJwt().isSecureCookie())
                .sameSite("Lax")
                .path("/")
                .maxAge(maxAgeSeconds)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}

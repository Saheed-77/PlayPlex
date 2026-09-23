package local.playplex.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import local.playplex.domain.Role;
import local.playplex.domain.StaffUser;

import java.time.Instant;

/** Request and response shapes for /api/auth (docs/04 §2). */
public class AuthDtos {

    public record LoginRequest(@NotBlank String username, @NotBlank String password) { }

    public record ChangePasswordRequest(
            @NotBlank String currentPassword,
            @NotBlank @Size(min = 8, message = "Use at least 8 characters.") String newPassword) { }

    /** Never carries the password hash. */
    public record UserDto(Long id, String username, String fullName, Role role, boolean active,
                          boolean mustChangePassword, Instant lastLoginAt, Instant createdAt) {

        public static UserDto of(StaffUser u) {
            return new UserDto(u.getId(), u.getUsername(), u.getFullName(), u.getRole(), u.isActive(),
                    u.isMustChangePassword(), u.getLastLoginAt(), u.getCreatedAt());
        }
    }

    public record AuthResponse(UserDto user, Instant serverTime) { }
}

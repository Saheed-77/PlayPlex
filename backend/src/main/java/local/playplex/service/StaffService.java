package local.playplex.service;

import local.playplex.api.dto.AdminDtos.PasswordReset;
import local.playplex.api.dto.AdminDtos.StaffInput;
import local.playplex.api.dto.AdminDtos.StaffUpdate;
import local.playplex.api.dto.AdminDtos.TemporaryPassword;
import local.playplex.api.dto.AuthDtos.UserDto;
import local.playplex.domain.Role;
import local.playplex.domain.StaffUser;
import local.playplex.error.ApiException;
import local.playplex.repo.StaffUserRepository;
import local.playplex.security.CurrentUser;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Volunteers arrive on the morning of the event and are handed an account in a few seconds
 * (docs/05 A4). The password is generated here, shown once, and stored only as a hash —
 * nobody, including admin, can read it back afterwards.
 */
@Service
public class StaffService {

    private static final Pattern USERNAME = Pattern.compile("^[a-z0-9._]{3,30}$");
    /** No l/i/o/0/1: these get read aloud across a noisy hall. */
    private static final String ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

    private final StaffUserRepository users;
    private final PasswordEncoder encoder;
    private final AuditService audit;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public StaffService(StaffUserRepository users, PasswordEncoder encoder, AuditService audit, Clock clock) {
        this.users = users;
        this.encoder = encoder;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<UserDto> list() {
        return users.findAllByOrderByIdAsc().stream().map(UserDto::of).toList();
    }

    @Transactional
    public TemporaryPassword create(StaffInput input, CurrentUser actor) {
        Map<String, String> errors = new LinkedHashMap<>();
        String username = input.username() == null ? "" : input.username().trim().toLowerCase(Locale.ROOT);
        if (!USERNAME.matcher(username).matches()) {
            errors.put("username", "3-30 lowercase letters, digits, dots or underscores.");
        } else if (users.existsByUsername(username)) {
            errors.put("username", username + " is taken.");
        }
        String fullName = input.fullName() == null ? "" : input.fullName().trim();
        if (fullName.length() < 2) errors.put("fullName", "Enter their name.");
        if (input.role() == null) errors.put("role", "Pick a role.");
        if (!errors.isEmpty()) throw ApiException.validation(errors.values().iterator().next(), errors);

        String temporary = temporaryPassword();
        StaffUser user = new StaffUser();
        user.setUsername(username);
        user.setFullName(fullName);
        user.setRole(input.role());
        user.setPasswordHash(encoder.encode(temporary));
        user.setMustChangePassword(true);
        user.setActive(true);
        user.setCreatedAt(clock.instant());
        users.save(user);

        audit.record(actor.id(), "STAFF_CREATED", "staff_user", user.getId(), username, null,
                Map.of("role", user.getRole().name()));
        return new TemporaryPassword(UserDto.of(user), temporary);
    }

    @Transactional
    public UserDto update(Long id, StaffUpdate input, CurrentUser actor) {
        StaffUser target = users.findById(id).orElseThrow(() -> ApiException.notFound("User"));
        boolean wasActive = target.isActive();
        Map<String, Object> before = Map.of("fullName", target.getFullName(),
                "role", target.getRole().name(), "active", wasActive);

        // Locking yourself out mid-event would mean nobody can fix anything.
        boolean self = target.getId().equals(actor.id());
        boolean demoting = input.role() != null && input.role() != Role.ADMIN;
        if (self && (Boolean.FALSE.equals(input.active()) || demoting)) {
            throw ApiException.rule("You can't deactivate or demote your own account.");
        }

        if (input.fullName() != null && !input.fullName().isBlank()) target.setFullName(input.fullName().trim());
        if (input.role() != null) target.setRole(input.role());
        if (input.active() != null) target.setActive(input.active());
        users.save(target);

        String action = wasActive && !target.isActive() ? "STAFF_DEACTIVATED"
                : !wasActive && target.isActive() ? "STAFF_REACTIVATED" : "STAFF_UPDATED";
        audit.record(actor.id(), action, "staff_user", target.getId(), target.getUsername(), before,
                Map.of("fullName", target.getFullName(), "role", target.getRole().name(),
                        "active", target.isActive()));
        return UserDto.of(target);
    }

    @Transactional
    public PasswordReset resetPassword(Long id, CurrentUser actor) {
        StaffUser target = users.findById(id).orElseThrow(() -> ApiException.notFound("User"));
        String temporary = temporaryPassword();
        target.setPasswordHash(encoder.encode(temporary));
        target.setMustChangePassword(true);
        users.save(target);
        audit.record(actor.id(), "PASSWORD_RESET", "staff_user", target.getId(), target.getUsername(),
                null, Map.of());
        return new PasswordReset(temporary);
    }

    private String temporaryPassword() {
        return "ppx-" + block() + "-" + block();
    }

    private String block() {
        StringBuilder sb = new StringBuilder(4);
        for (int i = 0; i < 4; i++) sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        return sb.toString();
    }
}

package local.playplex.api;

import jakarta.validation.Valid;
import local.playplex.api.dto.AdminDtos.PasswordReset;
import local.playplex.api.dto.AdminDtos.StaffInput;
import local.playplex.api.dto.AdminDtos.StaffUpdate;
import local.playplex.api.dto.AdminDtos.TemporaryPassword;
import local.playplex.api.dto.AuthDtos.UserDto;
import local.playplex.security.CurrentUser;
import local.playplex.service.StaffService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Accounts for the people running the event (docs/04 §8.3). */
@RestController
@RequestMapping("/api/admin/users")
@PreAuthorize("hasRole('ADMIN')")
public class AdminStaffController {

    private final StaffService staff;

    public AdminStaffController(StaffService staff) { this.staff = staff; }

    @GetMapping
    public List<UserDto> list() { return staff.list(); }

    /** The temporary password is in this response and nowhere else — it is never stored in the clear. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public TemporaryPassword create(@Valid @RequestBody StaffInput input,
                                    @AuthenticationPrincipal CurrentUser user) {
        return staff.create(input, user);
    }

    @PatchMapping("/{id}")
    public UserDto update(@PathVariable Long id, @RequestBody StaffUpdate input,
                          @AuthenticationPrincipal CurrentUser user) {
        return staff.update(id, input, user);
    }

    @PostMapping("/{id}/reset-password")
    public PasswordReset resetPassword(@PathVariable Long id, @AuthenticationPrincipal CurrentUser user) {
        return staff.resetPassword(id, user);
    }
}

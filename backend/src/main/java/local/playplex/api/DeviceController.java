package local.playplex.api;

import jakarta.validation.constraints.NotNull;
import local.playplex.domain.DeviceStatus;
import local.playplex.security.CurrentUser;
import local.playplex.service.DeviceService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Floor-level device actions: volunteers and admin (docs/04 §7). */
@RestController
@RequestMapping("/api/devices")
@PreAuthorize("hasRole('VOLUNTEER')")
public class DeviceController {

    private final DeviceService devices;

    public DeviceController(DeviceService devices) { this.devices = devices; }

    public record StatusRequest(@NotNull DeviceStatus status, String reason) { }

    @PostMapping("/{id}/status")
    public void changeStatus(@PathVariable Long id, @RequestBody StatusRequest request,
                             @AuthenticationPrincipal CurrentUser user) {
        devices.changeStatus(id, request.status(), request.reason(), user);
    }

    @PostMapping("/{id}/ready")
    public void markReady(@PathVariable Long id, @AuthenticationPrincipal CurrentUser user) {
        devices.markReady(id, user);
    }
}

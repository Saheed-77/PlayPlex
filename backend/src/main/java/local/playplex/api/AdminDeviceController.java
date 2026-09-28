package local.playplex.api;

import jakarta.validation.Valid;
import local.playplex.api.dto.AdminDtos.*;
import local.playplex.security.CurrentUser;
import local.playplex.service.AdminDeviceService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** The floor plan: stations and the kinds of station there are (docs/04 §8). */
@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasRole('ADMIN')")
public class AdminDeviceController {

    private final AdminDeviceService service;

    public AdminDeviceController(AdminDeviceService service) { this.service = service; }

    @GetMapping("/devices")
    public List<AdminDeviceDto> devices() { return service.list(); }

    @GetMapping("/devices/suggest-code")
    public SuggestedCode suggestCode(@RequestParam Long deviceTypeId) {
        return service.suggestCode(deviceTypeId);
    }

    @PostMapping("/devices")
    @ResponseStatus(HttpStatus.CREATED)
    public AdminDeviceDto create(@Valid @RequestBody DeviceInput input,
                                 @AuthenticationPrincipal CurrentUser user) {
        return service.create(input, user);
    }

    @PatchMapping("/devices/{id}")
    public AdminDeviceDto update(@PathVariable Long id, @RequestBody DeviceUpdate input,
                                 @AuthenticationPrincipal CurrentUser user) {
        return service.update(id, input, user);
    }

    @DeleteMapping("/devices/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deactivate(@PathVariable Long id, @AuthenticationPrincipal CurrentUser user) {
        service.deactivate(id, user);
    }

    @GetMapping("/device-types")
    public List<DeviceTypeDto> types() { return service.listTypes(); }

    @PostMapping("/device-types")
    @ResponseStatus(HttpStatus.CREATED)
    public DeviceTypeDto createType(@RequestBody DeviceTypeInput input,
                                    @AuthenticationPrincipal CurrentUser user) {
        return service.createType(input, user);
    }

    @PatchMapping("/device-types/{id}")
    public DeviceTypeDto updateType(@PathVariable Long id, @RequestBody DeviceTypeInput input,
                                    @AuthenticationPrincipal CurrentUser user) {
        return service.updateType(id, input, user);
    }
}

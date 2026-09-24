package local.playplex.api;

import local.playplex.api.dto.SessionDtos.HandoverSummary;
import local.playplex.security.CurrentUser;
import local.playplex.service.ShiftService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/shift")
public class ShiftController {

    private final ShiftService shifts;

    public ShiftController(ShiftService shifts) { this.shifts = shifts; }

    @GetMapping("/summary")
    public HandoverSummary summary(@AuthenticationPrincipal CurrentUser user) {
        return shifts.summary(user);
    }

    @PostMapping("/end")
    public HandoverSummary endShift(@AuthenticationPrincipal CurrentUser user) {
        return shifts.endShift(user);
    }
}

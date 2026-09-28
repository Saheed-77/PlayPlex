package local.playplex.api;

import jakarta.validation.Valid;
import local.playplex.api.dto.AdminDtos.PlanDto;
import local.playplex.api.dto.AdminDtos.PlanInput;
import local.playplex.api.dto.AdminDtos.ReorderRequest;
import local.playplex.security.CurrentUser;
import local.playplex.service.PlanService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Reception needs the plan list to sell a ticket, so the read is open to anyone signed in;
 * everything that changes a price is admin-only.
 */
@RestController
@RequestMapping("/api")
public class PlanController {

    private final PlanService plans;

    public PlanController(PlanService plans) { this.plans = plans; }

    @GetMapping("/plans")
    public List<PlanDto> active() { return plans.listActive(); }

    @GetMapping("/admin/plans")
    @PreAuthorize("hasRole('ADMIN')")
    public List<PlanDto> all() { return plans.listAll(); }

    @PostMapping("/admin/plans")
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.CREATED)
    public PlanDto create(@Valid @RequestBody PlanInput input, @AuthenticationPrincipal CurrentUser user) {
        return plans.create(input, user);
    }

    @PatchMapping("/admin/plans/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public PlanDto update(@PathVariable Long id, @RequestBody PlanInput input,
                          @AuthenticationPrincipal CurrentUser user) {
        return plans.update(id, input, user);
    }

    @PostMapping("/admin/plans/reorder")
    @PreAuthorize("hasRole('ADMIN')")
    public List<PlanDto> reorder(@RequestBody ReorderRequest request) {
        return plans.reorder(request.ids());
    }
}

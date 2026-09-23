package local.playplex.api;

import local.playplex.api.dto.FloorDtos.FloorDto;
import local.playplex.security.CurrentUser;
import local.playplex.service.FloorService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Any signed-in role: the board everyone looks at (docs/04 §3). */
@RestController
@RequestMapping("/api/floor")
public class FloorController {

    private final FloorService floor;

    public FloorController(FloorService floor) { this.floor = floor; }

    @GetMapping
    public FloorDto get(@AuthenticationPrincipal CurrentUser user) {
        return floor.build(user);
    }
}

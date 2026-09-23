package local.playplex.api;

import local.playplex.api.dto.QueueDtos.QueueResponse;
import local.playplex.security.CurrentUser;
import local.playplex.service.QueueService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/queue")
public class QueueController {

    private final QueueService queue;

    public QueueController(QueueService queue) { this.queue = queue; }

    @GetMapping
    public QueueResponse list(@RequestParam(required = false) Long deviceTypeId,
                              @RequestParam(required = false) String q,
                              @AuthenticationPrincipal CurrentUser user) {
        return queue.list(deviceTypeId, q, user);
    }
}

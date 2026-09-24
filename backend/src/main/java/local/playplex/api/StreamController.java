package local.playplex.api;

import local.playplex.live.LiveEventBroadcaster;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** GET /api/stream — any signed-in role (docs/04 §11). */
@RestController
public class StreamController {

    private final LiveEventBroadcaster broadcaster;

    public StreamController(LiveEventBroadcaster broadcaster) { this.broadcaster = broadcaster; }

    @GetMapping(path = "/api/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream() {
        return broadcaster.subscribe();
    }
}

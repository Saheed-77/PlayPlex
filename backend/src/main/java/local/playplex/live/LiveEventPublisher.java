package local.playplex.live;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Services call this as they work; subscribers only hear about it once the transaction
 * commits (see LiveEventBroadcaster). Announcing an assignment that then rolls back would
 * leave every board showing a session that does not exist.
 */
@Component
public class LiveEventPublisher {

    private final ApplicationEventPublisher publisher;

    public LiveEventPublisher(ApplicationEventPublisher publisher) { this.publisher = publisher; }

    public void publish(LiveEvent.Type type, Map<String, Object> data) {
        publisher.publishEvent(LiveEvent.of(type, data));
    }

    public void deviceUpdated(Long deviceId, String code, Object status, String statusReason) {
        Map<String, Object> data = new java.util.HashMap<>();
        data.put("deviceId", deviceId);
        data.put("code", code);
        data.put("status", status);
        data.put("statusReason", statusReason);
        publish(LiveEvent.Type.DEVICE_UPDATED, data);
    }

    public void ticketFlagged(Long ticketId, String ticketNo, String flag) {
        Map<String, Object> data = new java.util.HashMap<>();
        data.put("ticketId", ticketId);
        data.put("ticketNo", ticketNo);
        data.put("flag", flag);
        publish(LiveEvent.Type.TICKET_FLAGGED, data);
    }
}

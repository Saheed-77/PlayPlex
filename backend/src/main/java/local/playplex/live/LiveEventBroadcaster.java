package local.playplex.live;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * The SSE fan-out (docs/04 §11, ADR-001). One-way server to client is all the dashboards
 * need, which is why this is SSE and not WebSockets.
 *
 * Emitters live in a CopyOnWriteArrayList because the read path (broadcasting) massively
 * outnumbers the write path (a tablet connecting), and a volunteer's tablet dropping
 * mid-broadcast must not break delivery for everyone else.
 */
@Component
public class LiveEventBroadcaster {

    private static final Logger log = LoggerFactory.getLogger(LiveEventBroadcaster.class);

    private final List<SseEmitter> emitters = new CopyOnWriteArrayList<>();

    /** Timeout 0 = never time out; the client reconnects on its own if the socket dies. */
    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(0L);
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> {
            emitter.complete();
            emitters.remove(emitter);
        });
        emitter.onError(e -> emitters.remove(emitter));
        try {
            // An immediate comment makes the browser's EventSource fire `open`, which is what
            // flips the connection indicator to green.
            emitter.send(SseEmitter.event().comment("connected"));
        } catch (IOException e) {
            emitters.remove(emitter);
        }
        return emitter;
    }

    /**
     * AFTER_COMMIT: the work is durable before anyone is told about it. A client acting on
     * an event can therefore always trust that the row it refers to exists.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onLiveEvent(LiveEvent event) {
        broadcast(event);
    }

    public void broadcast(LiveEvent event) {
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().name(event.type().wireName()).data(event.data()));
            } catch (Exception ex) {
                // A closed tablet is normal, not an error worth shouting about.
                emitters.remove(emitter);
                log.debug("Dropped a dead SSE subscriber: {}", ex.toString());
            }
        }
    }

    /** Proxies kill idle connections, so say something harmless every 20 seconds. */
    public void heartbeat() {
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().comment("heartbeat"));
            } catch (Exception ex) {
                emitters.remove(emitter);
            }
        }
    }

    public int subscriberCount() { return emitters.size(); }
}

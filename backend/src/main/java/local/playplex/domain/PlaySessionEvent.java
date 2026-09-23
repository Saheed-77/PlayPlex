package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;

/** The session's own history: started, extended, paused, resumed, warned, overdue, ended. */
@Entity
@Table(name = "play_session_event")
public class PlaySessionEvent {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "play_session_id", nullable = false)
    private PlaySession session;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private SessionEventType type;

    @Column(columnDefinition = "json")
    private String payload;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "by_user_id")
    private StaffUser by;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public PlaySession getSession() { return session; }
    public void setSession(PlaySession session) { this.session = session; }
    public SessionEventType getType() { return type; }
    public void setType(SessionEventType type) { this.type = type; }
    public String getPayload() { return payload; }
    public void setPayload(String payload) { this.payload = payload; }
    public Instant getOccurredAt() { return occurredAt; }
    public void setOccurredAt(Instant occurredAt) { this.occurredAt = occurredAt; }
    public StaffUser getBy() { return by; }
    public void setBy(StaffUser by) { this.by = by; }
}

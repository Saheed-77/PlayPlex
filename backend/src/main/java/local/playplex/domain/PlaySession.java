package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * An actual play period. There is deliberately no status column: running, ending-soon,
 * overdue and paused are all derived from these timestamps (docs/03 §2.9).
 *
 * `active_device_id` is a STORED generated column with a unique key — it is what stops
 * two volunteers assigning the same device, and it is not mapped here on purpose.
 */
@Entity
@Table(name = "play_session")
public class PlaySession {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "device_id", nullable = false)
    private Device device;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    /** Moves forward on an extension, and on resume by exactly the paused duration. */
    @Column(name = "planned_end_at", nullable = false)
    private Instant plannedEndAt;

    /** null = still running. */
    @Column(name = "ended_at")
    private Instant endedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "end_reason", length = 20)
    private EndReason endReason;

    @Column(name = "end_note", length = 200)
    private String endNote;

    @Column(name = "extension_minutes_total", nullable = false)
    private short extensionMinutesTotal = 0;

    /** Set while play is stopped by a fault (docs/02 §8). */
    @Column(name = "paused_at")
    private Instant pausedAt;

    /** Budget consumed, including minutes handed back as lost time. */
    @Column(name = "paused_total_seconds", nullable = false)
    private int pausedTotalSeconds = 0;

    @Enumerated(EnumType.STRING)
    @Column(name = "pause_reason", length = 30)
    private PauseReason pauseReason;

    /** So the sweep alerts once, not every 15 seconds. */
    @Column(name = "overdue_notified_at")
    private Instant overdueNotifiedAt;

    @Column(name = "warned_at")
    private Instant warnedAt;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "started_by_user_id", nullable = false)
    private StaffUser startedBy;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ended_by_user_id")
    private StaffUser endedBy;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Device getDevice() { return device; }
    public void setDevice(Device device) { this.device = device; }
    public Instant getStartedAt() { return startedAt; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public Instant getPlannedEndAt() { return plannedEndAt; }
    public void setPlannedEndAt(Instant plannedEndAt) { this.plannedEndAt = plannedEndAt; }
    public Instant getEndedAt() { return endedAt; }
    public void setEndedAt(Instant endedAt) { this.endedAt = endedAt; }
    public EndReason getEndReason() { return endReason; }
    public void setEndReason(EndReason endReason) { this.endReason = endReason; }
    public String getEndNote() { return endNote; }
    public void setEndNote(String endNote) { this.endNote = endNote; }
    public short getExtensionMinutesTotal() { return extensionMinutesTotal; }
    public void setExtensionMinutesTotal(short v) { this.extensionMinutesTotal = v; }
    public Instant getPausedAt() { return pausedAt; }
    public void setPausedAt(Instant pausedAt) { this.pausedAt = pausedAt; }
    public int getPausedTotalSeconds() { return pausedTotalSeconds; }
    public void setPausedTotalSeconds(int v) { this.pausedTotalSeconds = v; }
    public PauseReason getPauseReason() { return pauseReason; }
    public void setPauseReason(PauseReason pauseReason) { this.pauseReason = pauseReason; }
    public Instant getOverdueNotifiedAt() { return overdueNotifiedAt; }
    public void setOverdueNotifiedAt(Instant v) { this.overdueNotifiedAt = v; }
    public Instant getWarnedAt() { return warnedAt; }
    public void setWarnedAt(Instant warnedAt) { this.warnedAt = warnedAt; }
    public StaffUser getStartedBy() { return startedBy; }
    public void setStartedBy(StaffUser startedBy) { this.startedBy = startedBy; }
    public StaffUser getEndedBy() { return endedBy; }
    public void setEndedBy(StaffUser endedBy) { this.endedBy = endedBy; }
}

package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;

/** Answers, on Monday: which laptop kept dying, and for how long was it down? */
@Entity
@Table(name = "device_status_log")
public class DeviceStatusLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "device_id", nullable = false)
    private Device device;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", nullable = false, length = 20)
    private DeviceStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", nullable = false, length = 20)
    private DeviceStatus toStatus;

    @Column(length = 200)
    private String reason;

    @Column(name = "changed_at", nullable = false)
    private Instant changedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "by_user_id")
    private StaffUser by;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Device getDevice() { return device; }
    public void setDevice(Device device) { this.device = device; }
    public DeviceStatus getFromStatus() { return fromStatus; }
    public void setFromStatus(DeviceStatus v) { this.fromStatus = v; }
    public DeviceStatus getToStatus() { return toStatus; }
    public void setToStatus(DeviceStatus v) { this.toStatus = v; }
    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
    public Instant getChangedAt() { return changedAt; }
    public void setChangedAt(Instant changedAt) { this.changedAt = changedAt; }
    public StaffUser getBy() { return by; }
    public void setBy(StaffUser by) { this.by = by; }
}

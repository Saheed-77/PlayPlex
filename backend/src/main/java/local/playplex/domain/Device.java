package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "device")
public class Device {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "device_type_id", nullable = false)
    private DeviceType deviceType;

    @Column(nullable = false, unique = true, length = 20)
    private String code;

    @Column(nullable = false, length = 60)
    private String label = "";

    @Column(name = "location_note", nullable = false, length = 120)
    private String locationNote = "";

    @Column(nullable = false)
    private short capacity = 1;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private DeviceStatus status = DeviceStatus.AVAILABLE;

    /** Required when OUT_OF_SERVICE — the board shows it to everyone. */
    @Column(name = "status_reason", length = 200)
    private String statusReason;

    /** Drives the auto-clear of CLEANING. */
    @Column(name = "status_changed_at", nullable = false)
    private Instant statusChangedAt;

    @Column(nullable = false)
    private boolean active = true;

    /** Optimistic locking, on top of the pessimistic lock taken when assigning. */
    @Version
    @Column(nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public DeviceType getDeviceType() { return deviceType; }
    public void setDeviceType(DeviceType deviceType) { this.deviceType = deviceType; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getLabel() { return label; }
    public void setLabel(String label) { this.label = label; }
    public String getLocationNote() { return locationNote; }
    public void setLocationNote(String locationNote) { this.locationNote = locationNote; }
    public short getCapacity() { return capacity; }
    public void setCapacity(short capacity) { this.capacity = capacity; }
    public DeviceStatus getStatus() { return status; }
    public void setStatus(DeviceStatus status) { this.status = status; }
    public String getStatusReason() { return statusReason; }
    public void setStatusReason(String statusReason) { this.statusReason = statusReason; }
    public Instant getStatusChangedAt() { return statusChangedAt; }
    public void setStatusChangedAt(Instant v) { this.statusChangedAt = v; }
    public boolean isActive() { return active; }
    public void setActive(boolean active) { this.active = active; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}

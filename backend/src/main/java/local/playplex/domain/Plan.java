package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

/**
 * A purchasable slot. Editing a price affects future sales only, because every ticket
 * carries a price snapshot (ADR-005).
 */
@Entity
@Table(name = "plan")
public class Plan {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 60)
    private String name;

    @Column(name = "duration_minutes", nullable = false)
    private short durationMinutes;

    /** Integer paise. Never a float (ADR-003). */
    @Column(name = "price_paise", nullable = false)
    private int pricePaise;

    @Column(nullable = false, length = 200)
    private String description = "";

    /** Console Duo sells one ticket for two seats. */
    @Column(name = "seats_per_ticket", nullable = false)
    private short seatsPerTicket = 1;

    @Column(name = "sort_order", nullable = false)
    private short sortOrder = 0;

    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** Empty means the plan applies to every device type — the common case. */
    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "plan_device_type",
            joinColumns = @JoinColumn(name = "plan_id"),
            inverseJoinColumns = @JoinColumn(name = "device_type_id"))
    private Set<DeviceType> deviceTypes = new HashSet<>();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public short getDurationMinutes() { return durationMinutes; }
    public void setDurationMinutes(short v) { this.durationMinutes = v; }
    public int getPricePaise() { return pricePaise; }
    public void setPricePaise(int pricePaise) { this.pricePaise = pricePaise; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public short getSeatsPerTicket() { return seatsPerTicket; }
    public void setSeatsPerTicket(short v) { this.seatsPerTicket = v; }
    public short getSortOrder() { return sortOrder; }
    public void setSortOrder(short v) { this.sortOrder = v; }
    public boolean isActive() { return active; }
    public void setActive(boolean active) { this.active = active; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Set<DeviceType> getDeviceTypes() { return deviceTypes; }
    public void setDeviceTypes(Set<DeviceType> deviceTypes) { this.deviceTypes = deviceTypes; }
}

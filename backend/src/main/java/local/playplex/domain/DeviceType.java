package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * A category of station. This table is why the system is scalable: adding VR headsets on
 * day two is one INSERT from the admin UI — no enum, no deploy (docs/03 §2.2).
 */
@Entity
@Table(name = "device_type")
public class DeviceType {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 20)
    private String code;

    @Column(nullable = false, length = 60)
    private String name;

    /** lucide-react icon name, e.g. gamepad-2. */
    @Column(nullable = false, length = 40)
    private String icon;

    @Column(name = "default_capacity", nullable = false)
    private short defaultCapacity = 1;

    @Column(name = "sort_order", nullable = false)
    private short sortOrder = 0;

    @Column(nullable = false)
    private boolean active = true;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getIcon() { return icon; }
    public void setIcon(String icon) { this.icon = icon; }
    public short getDefaultCapacity() { return defaultCapacity; }
    public void setDefaultCapacity(short v) { this.defaultCapacity = v; }
    public short getSortOrder() { return sortOrder; }
    public void setSortOrder(short v) { this.sortOrder = v; }
    public boolean isActive() { return active; }
    public void setActive(boolean active) { this.active = active; }
}

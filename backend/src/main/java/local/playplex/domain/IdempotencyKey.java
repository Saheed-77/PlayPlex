package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * Stored in MySQL rather than a cache on purpose: the key and the action it guards commit
 * or roll back together, so a double-click can never half-happen (docs/04 §1).
 */
@Entity
@Table(name = "idempotency_key")
public class IdempotencyKey {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "key_value", nullable = false, length = 100)
    private String keyValue;

    @Column(nullable = false, length = 10)
    private String method;

    @Column(nullable = false, length = 200)
    private String path;

    @Column(name = "response_json", nullable = false, columnDefinition = "json")
    private String responseJson;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getKeyValue() { return keyValue; }
    public void setKeyValue(String keyValue) { this.keyValue = keyValue; }
    public String getMethod() { return method; }
    public void setMethod(String method) { this.method = method; }
    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }
    public String getResponseJson() { return responseJson; }
    public void setResponseJson(String responseJson) { this.responseJson = responseJson; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}

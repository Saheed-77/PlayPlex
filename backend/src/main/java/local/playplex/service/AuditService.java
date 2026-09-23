package local.playplex.service;

import local.playplex.domain.AuditLog;
import local.playplex.domain.StaffUser;
import local.playplex.repo.AuditLogRepository;
import local.playplex.repo.StaffUserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.util.Map;

/**
 * Written from the service layer, not scattered through controllers. Log every action that
 * touches money, overrides a rule or changes configuration — it is what lets admin answer
 * "why did PPX-0031 wait 50 minutes?" on Monday (docs/03 §2.13).
 */
@Service
public class AuditService {

    private final AuditLogRepository repo;
    private final StaffUserRepository users;
    private final ObjectMapper json;
    private final Clock clock;

    public AuditService(AuditLogRepository repo, StaffUserRepository users, ObjectMapper json, Clock clock) {
        this.repo = repo;
        this.users = users;
        this.json = json;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(Long actorId, String action, String entityType, Long entityId, String entityLabel,
                       Map<String, ?> before, Map<String, ?> after) {
        AuditLog entry = new AuditLog();
        if (actorId != null) {
            StaffUser actor = users.getReferenceById(actorId);
            entry.setActor(actor);
        }
        entry.setAction(action);
        entry.setEntityType(entityType);
        entry.setEntityId(entityId);
        entry.setEntityLabel(entityLabel);
        entry.setBeforeJson(before == null ? null : json.writeValueAsString(before));
        entry.setAfterJson(after == null ? null : json.writeValueAsString(after));
        entry.setOccurredAt(clock.instant());
        repo.save(entry);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(Long actorId, String action, String entityType, Long entityId, String entityLabel,
                       Map<String, ?> after) {
        record(actorId, action, entityType, entityId, entityLabel, null, after);
    }
}

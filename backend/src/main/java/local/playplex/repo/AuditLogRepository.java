package local.playplex.repo;

import local.playplex.domain.AuditLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;

public interface AuditLogRepository extends JpaRepository<AuditLog, Long> {

    @Query("""
            select a from AuditLog a left join fetch a.actor
            where (:action is null or a.action = :action)
              and (:userId is null or a.actor.id = :userId)
              and a.occurredAt >= :from and a.occurredAt < :to
            order by a.occurredAt desc
            """)
    Page<AuditLog> search(String action, Long userId, Instant from, Instant to, Pageable pageable);
}

package local.playplex.repo;

import local.playplex.domain.IdempotencyKey;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.Optional;

public interface IdempotencyKeyRepository extends JpaRepository<IdempotencyKey, Long> {

    Optional<IdempotencyKey> findByKeyValueAndMethodAndPath(String keyValue, String method, String path);

    @Modifying
    @Query("delete from IdempotencyKey k where k.createdAt < :before")
    int deleteOlderThan(Instant before);
}

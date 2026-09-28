package local.playplex.repo;

import local.playplex.domain.PlaySession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface PlaySessionRepository extends JpaRepository<PlaySession, Long> {

    @Query("select s from PlaySession s join fetch s.device where s.endedAt is null")
    List<PlaySession> findActive();

    @Query("select s from PlaySession s where s.device.id = :deviceId and s.endedAt is null")
    Optional<PlaySession> findActiveByDevice(Long deviceId);

    @Query("select s from PlaySession s join fetch s.device where s.startedAt >= :from and s.startedAt < :to")
    List<PlaySession> findStartedBetween(Instant from, Instant to);

    /** The overdue sweep: past time, still running, not yet announced (docs/07 task 3.11). */
    @Query("select s from PlaySession s join fetch s.device where s.endedAt is null and s.pausedAt is null and s.plannedEndAt < :now and s.overdueNotifiedAt is null")
    List<PlaySession> findNewlyOverdue(Instant now);

    @Query("select s from PlaySession s join fetch s.device where s.endedAt is null and s.pausedAt is not null")
    List<PlaySession> findPaused();

    List<PlaySession> findByStartedByIdAndStartedAtGreaterThanEqualOrderByStartedAtDesc(Long userId, Instant since);
    /** Anything that overlapped the window, including a session still running now. */
    @Query("""
            select s from PlaySession s join fetch s.device d join fetch d.deviceType
            where s.startedAt < :to and (s.endedAt is null or s.endedAt > :from)
            """)
    List<PlaySession> findOverlapping(Instant from, Instant to);

    @Query("select s from PlaySession s join fetch s.device where s.endedAt >= :from and s.endedAt < :to")
    List<PlaySession> findEndedBetween(Instant from, Instant to);

}

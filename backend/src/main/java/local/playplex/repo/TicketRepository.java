package local.playplex.repo;

import local.playplex.domain.Ticket;
import local.playplex.domain.TicketStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;

public interface TicketRepository extends JpaRepository<Ticket, Long> {

    /**
     * The queue, exactly as docs/02 §6.1 defines it: still waiting, wanting this device
     * type or any device, priority first and then FIFO.
     */
    @Query("""
            select t from Ticket t
              join fetch t.student
              left join fetch t.preferredDeviceType
            where t.status = 'QUEUED'
              and (:deviceTypeId is null or t.preferredDeviceType is null or t.preferredDeviceType.id = :deviceTypeId)
            order by t.priority desc, t.queuedAt asc, t.id asc
            """)
    List<Ticket> findQueue(Long deviceTypeId);

    @Query("""
            select t from Ticket t
              join fetch t.student
              left join fetch t.preferredDeviceType
            where t.createdAt >= :from and t.createdAt < :to
            order by t.queuedAt desc
            """)
    List<Ticket> findCreatedBetween(Instant from, Instant to);

    List<Ticket> findByStatusIn(List<TicketStatus> statuses);

    long countByStudentIdAndStatusNot(Long studentId, TicketStatus status);
}

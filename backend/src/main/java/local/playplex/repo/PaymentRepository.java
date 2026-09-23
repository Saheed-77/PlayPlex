package local.playplex.repo;

import local.playplex.domain.Payment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;

public interface PaymentRepository extends JpaRepository<Payment, Long> {

    List<Payment> findByTicketIdOrderByCollectedAtAsc(Long ticketId);

    /** A ticket's balance is the sum of its rows — refunds are negative ones. */
    @Query("select coalesce(sum(p.amountPaise), 0) from Payment p where p.ticket.id = :ticketId")
    int balanceOf(Long ticketId);

    @Query("select p from Payment p join fetch p.ticket join fetch p.collectedBy where p.collectedAt >= :from and p.collectedAt < :to")
    List<Payment> findCollectedBetween(Instant from, Instant to);
}

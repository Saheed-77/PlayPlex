package local.playplex.repo;

import local.playplex.domain.PlaySessionPlayer;
import local.playplex.domain.PlaySessionPlayerId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface PlaySessionPlayerRepository extends JpaRepository<PlaySessionPlayer, PlaySessionPlayerId> {

    @Query("""
            select p from PlaySessionPlayer p
              join fetch p.ticket t
              join fetch t.student
            where p.session.id in :sessionIds
            order by p.seatNo
            """)
    List<PlaySessionPlayer> findBySessionIds(List<Long> sessionIds);

    @Query("select p from PlaySessionPlayer p join fetch p.ticket t join fetch t.student where p.session.id = :sessionId order by p.seatNo")
    List<PlaySessionPlayer> findBySession(Long sessionId);

    @Query("select p from PlaySessionPlayer p join fetch p.session where p.ticket.id = :ticketId")
    List<PlaySessionPlayer> findByTicket(Long ticketId);
    /** Every seat ever taken, with the station it was on: the join reports need to attribute money. */
    @Query("""
            select p from PlaySessionPlayer p
              join fetch p.ticket
              join fetch p.session s
              join fetch s.device d
              join fetch d.deviceType
            """)
    List<PlaySessionPlayer> findAllWithDevice();

}

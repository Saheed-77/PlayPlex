package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * Links a ticket to a session. Usually one row; a PS5 session can have two. Modelling it
 * as a join table from the start means the two-seat case is not a special case in code.
 */
@Entity
@Table(name = "play_session_player")
@IdClass(PlaySessionPlayerId.class)
public class PlaySessionPlayer {
    @Id
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "play_session_id", nullable = false)
    private PlaySession session;

    @Id
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "ticket_id", nullable = false)
    private Ticket ticket;

    @Column(name = "seat_no", nullable = false)
    private short seatNo;

    /** Mirrors play_session.ended_at IS NULL; backs the one-live-session-per-ticket index. */
    @Column(nullable = false)
    private boolean active = true;

    public PlaySession getSession() { return session; }
    public void setSession(PlaySession session) { this.session = session; }
    public Ticket getTicket() { return ticket; }
    public void setTicket(Ticket ticket) { this.ticket = ticket; }
    public short getSeatNo() { return seatNo; }
    public void setSeatNo(short seatNo) { this.seatNo = seatNo; }
    public boolean isActive() { return active; }
    public void setActive(boolean active) { this.active = active; }
}

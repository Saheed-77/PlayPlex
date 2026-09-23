package local.playplex.domain;

import java.io.Serializable;
import java.util.Objects;

/** Composite key for the session/ticket join (docs/03 §2.10). */
public class PlaySessionPlayerId implements Serializable {
    private Long session;
    private Long ticket;

    public PlaySessionPlayerId() { }

    public PlaySessionPlayerId(Long session, Long ticket) {
        this.session = session;
        this.ticket = ticket;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof PlaySessionPlayerId other)) return false;
        return Objects.equals(session, other.session) && Objects.equals(ticket, other.ticket);
    }

    @Override
    public int hashCode() { return Objects.hash(session, ticket); }
}

package local.playplex.repo;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Gapless ticket numbers without a sequence (docs/03 §3.2). The UPDATE takes a row lock
 * that is held to the end of the surrounding transaction, so concurrent registrations
 * serialise on this one row and never collide.
 */
@Repository
public class SeqCounterRepository {

    private final JdbcTemplate jdbc;

    public SeqCounterRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Transactional(propagation = Propagation.MANDATORY)
    public long nextValue(String name) {
        jdbc.update("update seq_counter set next_val = next_val + 1 where name = ?", name);
        Long value = jdbc.queryForObject("select next_val - 1 from seq_counter where name = ?", Long.class, name);
        if (value == null) throw new IllegalStateException("Missing seq_counter row: " + name);
        return value;
    }

    /** PPX-0042: human-readable, printed, spoken aloud. */
    @Transactional(propagation = Propagation.MANDATORY)
    public String nextTicketNo() {
        return String.format("PPX-%04d", nextValue("ticket_no"));
    }
}

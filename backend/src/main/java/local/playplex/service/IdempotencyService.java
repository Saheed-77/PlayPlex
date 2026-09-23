package local.playplex.service;

import local.playplex.domain.IdempotencyKey;
import local.playplex.repo.IdempotencyKeyRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.util.Optional;

/**
 * Every state-changing POST carries an Idempotency-Key; a repeat returns the original
 * response instead of acting twice (docs/04 §1).
 *
 * The record is written in the same transaction as the action it guards, which is the whole
 * point of keeping it in MySQL rather than a cache: a rolled-back registration cannot leave
 * behind a key claiming a ticket that does not exist.
 */
@Service
public class IdempotencyService {

    private final IdempotencyKeyRepository repo;
    private final ObjectMapper json;
    private final Clock clock;

    public IdempotencyService(IdempotencyKeyRepository repo, ObjectMapper json, Clock clock) {
        this.repo = repo;
        this.json = json;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public <T> Optional<T> replay(String key, String method, String path, Class<T> type) {
        if (key == null || key.isBlank()) return Optional.empty();
        return repo.findByKeyValueAndMethodAndPath(key, method, path)
                .map(stored -> json.readValue(stored.getResponseJson(), type));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void remember(String key, String method, String path, Object response) {
        if (key == null || key.isBlank()) return;
        IdempotencyKey entry = new IdempotencyKey();
        entry.setKeyValue(key);
        entry.setMethod(method);
        entry.setPath(path);
        entry.setResponseJson(json.writeValueAsString(response));
        entry.setCreatedAt(clock.instant());
        repo.save(entry);
    }
}

package local.playplex.api;

import jakarta.validation.Valid;
import local.playplex.api.dto.SessionDtos.EndSessionRequest;
import local.playplex.api.dto.SessionDtos.SessionSummaryDto;
import local.playplex.api.dto.SessionDtos.StartSessionRequest;
import local.playplex.security.CurrentUser;
import local.playplex.service.IdempotencyService;
import local.playplex.service.SessionService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.Optional;

/** The floor: volunteers and admin, never reception (docs/01 §4.4). */
@RestController
@RequestMapping("/api/sessions")
@PreAuthorize("hasRole('VOLUNTEER')")
public class SessionController {

    private final SessionService sessions;
    private final IdempotencyService idempotency;

    public SessionController(SessionService sessions, IdempotencyService idempotency) {
        this.sessions = sessions;
        this.idempotency = idempotency;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public SessionSummaryDto start(@Valid @RequestBody StartSessionRequest request,
                                   @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                   @AuthenticationPrincipal CurrentUser user) {
        Optional<SessionSummaryDto> replay =
                idempotency.replay(key, "POST", "/api/sessions", SessionSummaryDto.class);
        if (replay.isPresent()) return replay.get();

        SessionSummaryDto started = sessions.start(request, user);
        idempotency.remember(key, "POST", "/api/sessions", started);
        return started;
    }

    @PostMapping("/{id}/end")
    @Transactional
    public SessionSummaryDto end(@PathVariable Long id,
                                 @Valid @RequestBody EndSessionRequest request,
                                 @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                 @AuthenticationPrincipal CurrentUser user) {
        String path = "/api/sessions/" + id + "/end";
        Optional<SessionSummaryDto> replay = idempotency.replay(key, "POST", path, SessionSummaryDto.class);
        if (replay.isPresent()) return replay.get();

        SessionSummaryDto ended = sessions.end(id, request.reason(), request.note(), user);
        idempotency.remember(key, "POST", path, ended);
        return ended;
    }
}

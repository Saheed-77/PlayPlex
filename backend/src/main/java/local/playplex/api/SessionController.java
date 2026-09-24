package local.playplex.api;

import jakarta.validation.Valid;
import local.playplex.api.dto.SessionDtos.BulkEndResponse;
import local.playplex.api.dto.SessionDtos.EndSessionRequest;
import local.playplex.api.dto.SessionDtos.ExtendRequest;
import local.playplex.api.dto.SessionDtos.LostTimeRequest;
import local.playplex.api.dto.SessionDtos.NoteRequest;
import local.playplex.api.dto.SessionDtos.PauseRequest;
import local.playplex.api.dto.SessionDtos.SessionSummaryDto;
import local.playplex.api.dto.SessionDtos.StartSessionRequest;
import local.playplex.domain.EndReason;
import local.playplex.domain.PlaySession;
import local.playplex.error.ApiException;
import local.playplex.repo.PlaySessionRepository;
import local.playplex.security.CurrentUser;
import local.playplex.service.ExtensionService;
import local.playplex.service.IdempotencyService;
import local.playplex.service.PauseService;
import local.playplex.service.SessionService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Optional;

/** The floor: volunteers and admin, never reception (docs/01 §4.4). */
@RestController
@RequestMapping("/api/sessions")
@PreAuthorize("hasRole('VOLUNTEER')")
public class SessionController {

    private final SessionService sessions;
    private final IdempotencyService idempotency;
    private final ExtensionService extensions;
    private final PauseService pauses;
    private final PlaySessionRepository sessionRepo;

    public SessionController(SessionService sessions, IdempotencyService idempotency,
                             ExtensionService extensions, PauseService pauses,
                             PlaySessionRepository sessionRepo) {
        this.sessions = sessions;
        this.idempotency = idempotency;
        this.extensions = extensions;
        this.pauses = pauses;
        this.sessionRepo = sessionRepo;
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

    @PostMapping("/{id}/extend")
    @Transactional
    public SessionSummaryDto extend(@PathVariable Long id, @Valid @RequestBody ExtendRequest request,
                                    @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                    @AuthenticationPrincipal CurrentUser user) {
        String path = "/api/sessions/" + id + "/extend";
        Optional<SessionSummaryDto> replay = idempotency.replay(key, "POST", path, SessionSummaryDto.class);
        if (replay.isPresent()) return replay.get();

        SessionSummaryDto extended = extensions.extend(id, request.minutes(), request.collectPayment(), user);
        idempotency.remember(key, "POST", path, extended);
        return extended;
    }

    /** Stops the clock during a fault; the held time comes back on resume (docs/02 §8). */
    @PostMapping("/{id}/pause")
    @Transactional
    public SessionSummaryDto pause(@PathVariable Long id, @Valid @RequestBody PauseRequest request,
                                   @AuthenticationPrincipal CurrentUser user) {
        return pauses.pause(id, request.reason(), request.note(), user);
    }

    @PostMapping("/{id}/resume")
    @Transactional
    public SessionSummaryDto resume(@PathVariable Long id, @AuthenticationPrincipal CurrentUser user) {
        return pauses.resume(id, user);
    }

    @PostMapping("/{id}/lost-time")
    @Transactional
    public SessionSummaryDto lostTime(@PathVariable Long id, @Valid @RequestBody LostTimeRequest request,
                                      @AuthenticationPrincipal CurrentUser user) {
        return pauses.giveBackLostTime(id, request.minutes(), request.reason(), request.note(), user);
    }

    @PostMapping("/{id}/force-end")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public SessionSummaryDto forceEnd(@PathVariable Long id, @RequestBody NoteRequest request,
                                      @AuthenticationPrincipal CurrentUser user) {
        if (request.note() == null || request.note().isBlank()) {
            throw ApiException.validation("Type the reason for forcing this session to end.",
                    java.util.Map.of("note", "Required."));
        }
        return sessions.end(id, EndReason.ADMIN_OVERRIDE, request.note(), user);
    }

    /** Closing the room: end everything still running, with one audited note. */
    @PostMapping("/end-all")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public BulkEndResponse endAll(@RequestBody NoteRequest request,
                                  @AuthenticationPrincipal CurrentUser user) {
        if (request.note() == null || request.note().isBlank()) {
            throw ApiException.validation("Add a note for closing the room.",
                    java.util.Map.of("note", "Required."));
        }
        List<PlaySession> running = sessionRepo.findActive();
        for (PlaySession session : running) {
            sessions.finish(session, EndReason.COMPLETED, request.note(), user, true);
        }
        return new BulkEndResponse(running.size());
    }

    /** What this volunteer has started since signing in — V4, My shift. */
    @GetMapping("/mine")
    public List<SessionSummaryDto> mine(@AuthenticationPrincipal CurrentUser user) {
        return sessionRepo.findAll().stream()
                .filter(s -> s.getStartedBy().getId().equals(user.id()))
                .sorted((a, b) -> b.getStartedAt().compareTo(a.getStartedAt()))
                .map(s -> sessions.summarise(s, user))
                .toList();
    }
}

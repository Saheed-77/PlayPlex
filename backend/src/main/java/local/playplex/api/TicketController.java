package local.playplex.api;

import jakarta.validation.Valid;
import local.playplex.api.dto.TicketDtos.CreateTicketRequest;
import local.playplex.api.dto.TicketDtos.StudentDto;
import local.playplex.api.dto.TicketDtos.TicketDto;
import local.playplex.security.CurrentUser;
import local.playplex.service.IdempotencyService;
import local.playplex.service.TicketService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Optional;

/**
 * Reception's desk. ADMIN inherits RECEPTION through the role hierarchy, so one annotation
 * covers both — and volunteers get a 403 from the server, not just a hidden button.
 */
@RestController
@RequestMapping("/api")
@PreAuthorize("hasRole('RECEPTION')")
public class TicketController {

    private final TicketService tickets;
    private final IdempotencyService idempotency;

    public TicketController(TicketService tickets, IdempotencyService idempotency) {
        this.tickets = tickets;
        this.idempotency = idempotency;
    }

    @PostMapping("/tickets")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public TicketDto create(@Valid @RequestBody CreateTicketRequest request,
                            @RequestHeader(value = "Idempotency-Key", required = false) String key,
                            @AuthenticationPrincipal CurrentUser user) {
        // A double-click returns the first ticket instead of selling a second one.
        Optional<TicketDto> replay = idempotency.replay(key, "POST", "/api/tickets", TicketDto.class);
        if (replay.isPresent()) return replay.get();

        TicketDto created = tickets.create(request, user);
        idempotency.remember(key, "POST", "/api/tickets", created);
        return created;
    }

    @GetMapping("/tickets/{id}")
    public TicketDto get(@PathVariable Long id) {
        return tickets.get(id);
    }

    @GetMapping("/students")
    public List<StudentDto> search(@RequestParam(required = false) String q) {
        return tickets.search(q);
    }
}

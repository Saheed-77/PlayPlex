package local.playplex.api;

import jakarta.validation.Valid;
import local.playplex.api.dto.TicketDtos.CancelRequest;
import local.playplex.api.dto.TicketDtos.CreateTicketRequest;
import local.playplex.api.dto.TicketDtos.PageDto;
import local.playplex.api.dto.TicketDtos.PriorityRequest;
import local.playplex.api.dto.TicketDtos.SettleRequest;
import local.playplex.api.dto.TicketDtos.StudentDto;
import local.playplex.api.dto.TicketDtos.TicketDetailDto;
import local.playplex.api.dto.TicketDtos.TicketDto;
import local.playplex.api.dto.TicketDtos.UpdateTicketRequest;
import local.playplex.domain.TicketStatus;
import local.playplex.security.CurrentUser;
import local.playplex.service.IdempotencyService;
import local.playplex.service.ReceptionService;
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
    private final ReceptionService reception;

    public TicketController(TicketService tickets, IdempotencyService idempotency,
                            ReceptionService reception) {
        this.tickets = tickets;
        this.idempotency = idempotency;
        this.reception = reception;
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

    /** Today's registrations; `dues=true` is the tab that must be empty before close. */
    @GetMapping("/tickets")
    public PageDto<TicketDto> list(@RequestParam(required = false) String q,
                                   @RequestParam(required = false) TicketStatus status,
                                   @RequestParam(required = false, defaultValue = "false") boolean dues,
                                   @RequestParam(defaultValue = "0") int page,
                                   @RequestParam(defaultValue = "50") int size) {
        return reception.list(q, status, dues, page, size);
    }

    @GetMapping("/tickets/{id}/detail")
    public TicketDetailDto detail(@PathVariable Long id) {
        return reception.detail(id);
    }

    @PatchMapping("/tickets/{id}")
    public TicketDto update(@PathVariable Long id, @RequestBody UpdateTicketRequest request,
                            @AuthenticationPrincipal CurrentUser user) {
        return reception.update(id, request, user);
    }

    @PostMapping("/tickets/{id}/cancel")
    public TicketDto cancel(@PathVariable Long id, @Valid @RequestBody CancelRequest request,
                            @AuthenticationPrincipal CurrentUser user) {
        return reception.cancel(id, request, user);
    }

    @PostMapping("/tickets/{id}/payments")
    public TicketDetailDto settle(@PathVariable Long id, @Valid @RequestBody SettleRequest request,
                                  @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                  @AuthenticationPrincipal CurrentUser user) {
        String path = "/api/tickets/" + id + "/payments";
        Optional<TicketDetailDto> replay = idempotency.replay(key, "POST", path, TicketDetailDto.class);
        if (replay.isPresent()) return replay.get();

        TicketDetailDto settled = reception.settle(id, request, user);
        idempotency.remember(key, "POST", path, settled);
        return settled;
    }

    /** Reception or a volunteer can put a returning no-show back in line (docs/02 E2). */
    @PostMapping("/tickets/{id}/requeue")
    @PreAuthorize("hasAnyRole('RECEPTION', 'VOLUNTEER')")
    public TicketDto requeue(@PathVariable Long id, @AuthenticationPrincipal CurrentUser user) {
        return reception.requeue(id, user);
    }

    @PostMapping("/tickets/{id}/no-show")
    @PreAuthorize("hasRole('VOLUNTEER')")
    public TicketDto noShow(@PathVariable Long id, @AuthenticationPrincipal CurrentUser user) {
        return reception.markNoShow(id, user);
    }

    @PostMapping("/tickets/{id}/priority")
    @PreAuthorize("hasRole('ADMIN')")
    public TicketDto priority(@PathVariable Long id, @Valid @RequestBody PriorityRequest request,
                              @AuthenticationPrincipal CurrentUser user) {
        return reception.setPriority(id, request.priority(), request.reason(), user);
    }
}

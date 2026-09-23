package local.playplex.service;

import local.playplex.api.dto.QueueDtos.QueueItemDto;
import local.playplex.api.dto.QueueDtos.QueueResponse;
import local.playplex.domain.Role;
import local.playplex.domain.Ticket;
import local.playplex.repo.TicketRepository;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** The queue is per device type, not one global line (docs/02 §6.1). */
@Service
public class QueueService {

    private final TicketRepository tickets;
    private final Clock clock;

    public QueueService(TicketRepository tickets, Clock clock) {
        this.tickets = tickets;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public QueueResponse list(Long deviceTypeId, String search, CurrentUser user) {
        Instant now = clock.instant();
        boolean volunteer = user.role() == Role.VOLUNTEER;
        String needle = search == null ? "" : search.trim().toLowerCase();

        List<QueueItemDto> items = new ArrayList<>();
        int position = 0;
        for (Ticket t : tickets.findQueue(deviceTypeId)) {
            position++;
            String fullName = t.getStudent().getFullName();
            if (!needle.isEmpty()
                    && !t.getTicketNo().toLowerCase().contains(needle)
                    && !fullName.toLowerCase().contains(needle)) {
                continue;
            }
            items.add(new QueueItemDto(
                    position,
                    t.getId(),
                    t.getTicketNo(),
                    Names.firstName(fullName),
                    // Reception and admin get contact details; volunteers never do.
                    volunteer ? null : fullName,
                    volunteer ? null : t.getStudent().getPhone(),
                    t.getPlanNameSnapshot(),
                    t.getDurationMinutesSnapshot(),
                    t.getSeatsPerTicket(),
                    t.getPreferredDeviceType() == null ? null : t.getPreferredDeviceType().getId(),
                    t.getPreferredDeviceType() == null ? null : t.getPreferredDeviceType().getCode(),
                    t.getPriority(),
                    t.getQueuedAt(),
                    (int) Duration.between(t.getQueuedAt(), now).toMinutes(),
                    t.getPaymentStatus()));
        }
        return new QueueResponse(now, deviceTypeId, items);
    }
}

package local.playplex.service;

import local.playplex.domain.Device;
import local.playplex.domain.DeviceType;
import local.playplex.domain.EventSettings;
import local.playplex.domain.PlaySession;
import local.playplex.domain.Ticket;
import local.playplex.repo.DeviceRepository;
import local.playplex.repo.DeviceTypeRepository;
import local.playplex.repo.PlaySessionRepository;
import local.playplex.repo.TicketRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Builds the `queue.updated` payload: length and per-type wait estimates (docs/04 §11). */
@Component
public class QueueEventFactory {

    private final TicketRepository tickets;
    private final DeviceRepository devices;
    private final DeviceTypeRepository deviceTypes;
    private final PlaySessionRepository sessions;
    private final SettingsService settingsService;
    private final Clock clock;

    public QueueEventFactory(TicketRepository tickets, DeviceRepository devices,
                             DeviceTypeRepository deviceTypes, PlaySessionRepository sessions,
                             SettingsService settingsService, Clock clock) {
        this.tickets = tickets;
        this.devices = devices;
        this.deviceTypes = deviceTypes;
        this.sessions = sessions;
        this.settingsService = settingsService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> payload() {
        List<Ticket> queue = tickets.findQueue(null);
        EventSettings settings = settingsService.get();
        Map<Long, PlaySession> byDevice = sessions.findActive().stream()
                .collect(Collectors.toMap(s -> s.getDevice().getId(), Function.identity(), (a, b) -> a));
        WaitEstimator estimator = new WaitEstimator(clock.instant(), devices.findAllActiveWithType(),
                byDevice, queue, settings);

        List<Map<String, Object>> byType = new ArrayList<>();
        for (DeviceType type : deviceTypes.findByActiveTrueOrderBySortOrderAsc()) {
            long length = queue.stream()
                    .filter(t -> t.getPreferredDeviceType() != null
                            && t.getPreferredDeviceType().getId().equals(type.getId()))
                    .count();
            byType.add(Map.of("id", type.getId(), "length", (int) length,
                    "estimatedWaitMinutes", estimator.waitForType(type.getId())));
        }
        return Map.of("queueLength", queue.size(), "byDeviceType", byType);
    }
}

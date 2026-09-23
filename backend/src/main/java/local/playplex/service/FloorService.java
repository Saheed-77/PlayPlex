package local.playplex.service;

import local.playplex.api.dto.FloorDtos.*;
import local.playplex.domain.*;
import local.playplex.repo.*;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * GET /api/floor — one call returns everything the volunteer board and the reception
 * availability strip need. One request instead of five is the difference between a board
 * that snaps and a board that flickers (docs/04 §3).
 */
@Service
public class FloorService {

    private final DeviceRepository devices;
    private final DeviceTypeRepository deviceTypes;
    private final PlaySessionRepository sessions;
    private final PlaySessionPlayerRepository players;
    private final TicketRepository tickets;
    private final SettingsService settingsService;
    private final Clock clock;

    public FloorService(DeviceRepository devices, DeviceTypeRepository deviceTypes,
                        PlaySessionRepository sessions, PlaySessionPlayerRepository players,
                        TicketRepository tickets, SettingsService settingsService, Clock clock) {
        this.devices = devices;
        this.deviceTypes = deviceTypes;
        this.sessions = sessions;
        this.players = players;
        this.tickets = tickets;
        this.settingsService = settingsService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public FloorDto build(CurrentUser user) {
        Instant now = clock.instant();
        EventSettings settings = settingsService.get();
        List<Device> allDevices = devices.findAllActiveWithType();
        List<PlaySession> active = sessions.findActive();
        Map<Long, PlaySession> sessionByDevice = active.stream()
                .collect(Collectors.toMap(s -> s.getDevice().getId(), Function.identity(), (a, b) -> a));
        Map<Long, List<PlaySessionPlayer>> playersBySession = active.isEmpty()
                ? Map.of()
                : players.findBySessionIds(active.stream().map(PlaySession::getId).toList()).stream()
                        .collect(Collectors.groupingBy(p -> p.getSession().getId()));
        List<Ticket> queue = tickets.findQueue(null);

        WaitEstimator estimator = new WaitEstimator(now, allDevices, sessionByDevice, queue, settings);
        Map<Long, Ticket> nextUp = nextUpByDevice(allDevices, queue);

        List<DeviceDto> deviceDtos = allDevices.stream()
                .map(d -> toDto(d, sessionByDevice.get(d.getId()), playersBySession, nextUp.get(d.getId()), now, user))
                .toList();

        List<TypeSummaryDto> byType = deviceTypes.findByActiveTrueOrderBySortOrderAsc().stream()
                .map(type -> {
                    List<Device> mine = allDevices.stream()
                            .filter(d -> d.getDeviceType().getId().equals(type.getId())).toList();
                    long queued = queue.stream()
                            .filter(t -> t.getPreferredDeviceType() != null
                                    && t.getPreferredDeviceType().getId().equals(type.getId()))
                            .count();
                    return new TypeSummaryDto(type.getId(), type.getCode(), type.getName(), type.getIcon(),
                            mine.size(), count(mine, DeviceStatus.AVAILABLE), count(mine, DeviceStatus.IN_USE),
                            count(mine, DeviceStatus.CLEANING), count(mine, DeviceStatus.OUT_OF_SERVICE),
                            (int) queued, estimator.waitForType(type.getId()));
                })
                .toList();

        SummaryDto summary = new SummaryDto(allDevices.size(), count(allDevices, DeviceStatus.AVAILABLE),
                count(allDevices, DeviceStatus.IN_USE), count(allDevices, DeviceStatus.CLEANING),
                count(allDevices, DeviceStatus.OUT_OF_SERVICE), queue.size(), estimator.waitForType(null));

        int duesCount = user.role() == Role.VOLUNTEER ? 0
                : tickets.findByStatusIn(List.of(TicketStatus.values())).stream()
                        .filter(t -> t.getPaymentStatus() == PaymentStatus.PAYMENT_DUE
                                || t.getPaymentStatus() == PaymentStatus.REFUND_DUE)
                        .mapToInt(t -> 1).sum();

        return new FloorDto(now, summary, byType, deviceDtos, SettingsService.toDto(settings), duesCount);
    }

    /**
     * Next-up per free device. Each queued ticket is offered to at most one station, so two
     * free laptops never both show the same person (frontend/src/mock/logic.ts nextUpMap).
     */
    public static Map<Long, Ticket> nextUpByDevice(List<Device> allDevices, List<Ticket> queue) {
        Set<Long> taken = new HashSet<>();
        Map<Long, Ticket> result = new HashMap<>();
        allDevices.stream()
                .filter(d -> d.getStatus() == DeviceStatus.AVAILABLE)
                .sorted(Comparator.comparing(Device::getCode))
                .forEach(device -> queue.stream()
                        .filter(t -> !taken.contains(t.getId()) && canTake(t, device))
                        .findFirst()
                        .ifPresent(pick -> {
                            taken.add(pick.getId());
                            result.put(device.getId(), pick);
                        }));
        return result;
    }

    /** Could this ticket start on this station right now? */
    public static boolean canTake(Ticket t, Device d) {
        boolean preferenceFits = t.getPreferredDeviceType() == null
                || t.getPreferredDeviceType().getId().equals(d.getDeviceType().getId());
        return t.getStatus() == TicketStatus.QUEUED
                && t.getPaymentStatus() != PaymentStatus.PAYMENT_DUE
                && preferenceFits
                && t.getSeatsPerTicket() <= d.getCapacity();
    }

    private DeviceDto toDto(Device d, PlaySession session, Map<Long, List<PlaySessionPlayer>> playersBySession,
                            Ticket next, Instant now, CurrentUser user) {
        SessionDto sessionDto = null;
        if (session != null) {
            List<PlayerDto> playerDtos = playersBySession.getOrDefault(session.getId(), List.of()).stream()
                    .map(p -> {
                        Ticket t = p.getTicket();
                        String name = user.role() == Role.VOLUNTEER
                                ? Names.firstName(t.getStudent().getFullName())
                                : t.getStudent().getFullName();
                        return new PlayerDto(t.getId(), t.getTicketNo(), name, t.getPlanNameSnapshot(),
                                t.getDurationMinutesSnapshot(), p.getSeatNo(), t.getPaymentStatus());
                    })
                    .toList();
            sessionDto = new SessionDto(session.getId(), session.getStartedAt(), session.getPlannedEndAt(),
                    session.getExtensionMinutesTotal(), session.getPausedAt(), session.getPausedTotalSeconds(),
                    session.getPauseReason(), session.getStartedBy().getFullName(), playerDtos);
        }
        NextUpDto nextUpDto = next == null ? null : new NextUpDto(next.getId(), next.getTicketNo(),
                Names.firstName(next.getStudent().getFullName()), next.getPlanNameSnapshot(),
                (int) Duration.between(next.getQueuedAt(), now).toMinutes(), next.getPriority());
        return new DeviceDto(d.getId(), d.getCode(), d.getLabel(), d.getLocationNote(),
                d.getDeviceType().getId(), d.getDeviceType().getCode(), d.getCapacity(), d.getStatus(),
                d.getStatusReason(), d.getStatusChangedAt(), sessionDto, nextUpDto);
    }

    private int count(List<Device> devices, DeviceStatus status) {
        return (int) devices.stream().filter(d -> d.getStatus() == status).count();
    }
}

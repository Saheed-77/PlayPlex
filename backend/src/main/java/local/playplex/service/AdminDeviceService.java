package local.playplex.service;

import local.playplex.api.dto.AdminDtos.*;
import local.playplex.domain.*;
import local.playplex.error.ApiException;
import local.playplex.error.ErrorCode;
import local.playplex.live.LiveEvent;
import local.playplex.live.LiveEventPublisher;
import local.playplex.repo.*;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;

/**
 * The floor plan as configuration (docs/05 A2). Stations are never really deleted — an
 * evening's numbers have to keep adding up, so a retired laptop is deactivated and its
 * history stays put.
 */
@Service
public class AdminDeviceService {

    private static final Pattern CODE = Pattern.compile("^[A-Z0-9]+-\\d{2,3}$");
    private static final Pattern TYPE_CODE = Pattern.compile("^[A-Z0-9]{2,6}$");

    private final DeviceRepository devices;
    private final DeviceTypeRepository types;
    private final DeviceStatusLogRepository statusLog;
    private final PlaySessionRepository sessions;
    private final PlaySessionPlayerRepository players;
    private final QueueEventFactory queueEvents;
    private final LiveEventPublisher live;
    private final AuditService audit;
    private final SettingsService settings;
    private final java.time.Clock clock;

    public AdminDeviceService(DeviceRepository devices, DeviceTypeRepository types,
                              DeviceStatusLogRepository statusLog, PlaySessionRepository sessions,
                              PlaySessionPlayerRepository players,
                              QueueEventFactory queueEvents, LiveEventPublisher live,
                              AuditService audit, SettingsService settings, java.time.Clock clock) {
        this.devices = devices;
        this.types = types;
        this.statusLog = statusLog;
        this.sessions = sessions;
        this.players = players;
        this.queueEvents = queueEvents;
        this.live = live;
        this.audit = audit;
        this.settings = settings;
        this.clock = clock;
    }

    // ── devices ──────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<AdminDeviceDto> list() {
        Instant now = clock.instant();
        EventDay day = EventDay.of(now, settings.get().getTimezone());
        List<Device> all = devices.findAllWithType();
        // One pass over today's sessions instead of a query per station.
        Map<Long, List<PlaySession>> byDevice = new HashMap<>();
        for (PlaySession s : sessions.findStartedBetween(day.from(), day.to())) {
            byDevice.computeIfAbsent(s.getDevice().getId(), k -> new ArrayList<>()).add(s);
        }
        return all.stream()
                .sorted(Comparator.comparing(Device::getCode))
                .map(d -> toDto(d, byDevice.getOrDefault(d.getId(), List.of()), day, now))
                .toList();
    }

    @Transactional(readOnly = true)
    public SuggestedCode suggestCode(Long deviceTypeId) {
        DeviceType type = types.findById(deviceTypeId).orElseThrow(() -> ApiException.notFound("Device type"));
        int highest = devices.findAllWithType().stream()
                .filter(d -> d.getDeviceType().getId().equals(type.getId()))
                .map(d -> suffix(d.getCode()))
                .filter(Objects::nonNull)
                .mapToInt(Integer::intValue)
                .max().orElse(0);
        return new SuggestedCode("%s-%02d".formatted(type.getCode(), highest + 1));
    }

    @Transactional
    public AdminDeviceDto create(DeviceInput input, CurrentUser actor) {
        Map<String, String> errors = new LinkedHashMap<>();
        DeviceType type = input.deviceTypeId() == null ? null
                : types.findById(input.deviceTypeId()).filter(DeviceType::isActive).orElse(null);
        if (type == null) errors.put("deviceTypeId", "Pick a device type.");

        String code = input.code() == null ? "" : input.code().trim().toUpperCase(Locale.ROOT);
        if (!CODE.matcher(code).matches()) errors.put("code", "Use the form LAP-11.");
        else if (devices.existsByCode(code)) errors.put("code", code + " already exists.");

        int capacity = input.capacity();
        if (capacity < 1 || capacity > 8) errors.put("capacity", "Seats must be 1-8.");
        if (!errors.isEmpty()) throw ApiException.validation(errors.values().iterator().next(), errors);

        Instant now = clock.instant();
        Device device = new Device();
        device.setDeviceType(type);
        device.setCode(code);
        device.setLabel(blankTo(input.label(), type.getName() + " " + code.substring(code.indexOf('-') + 1)));
        device.setLocationNote(blankTo(input.locationNote(), ""));
        device.setCapacity((short) capacity);
        device.setStatus(DeviceStatus.AVAILABLE);
        device.setStatusChangedAt(now);
        device.setCreatedAt(now);
        devices.save(device);

        audit.record(actor.id(), "DEVICE_CREATED", "device", device.getId(), device.getCode(), null,
                Map.of("type", type.getCode(), "capacity", capacity));
        live.deviceUpdated(device.getId(), device.getCode(), device.getStatus(), null);
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        return toDto(device, List.of(), EventDay.of(now, settings.get().getTimezone()), now);
    }

    @Transactional
    public AdminDeviceDto update(Long id, DeviceUpdate input, CurrentUser actor) {
        Device device = devices.findById(id).orElseThrow(() -> ApiException.notFound("Device"));
        Map<String, Object> before = Map.of("label", device.getLabel(), "locationNote", device.getLocationNote(),
                "capacity", (int) device.getCapacity(), "active", device.isActive());
        Instant now = clock.instant();

        if (input.label() != null) device.setLabel(input.label().trim());
        if (input.locationNote() != null) device.setLocationNote(input.locationNote().trim());
        if (input.capacity() != null) {
            int capacity = input.capacity();
            if (capacity < 1 || capacity > 8) {
                throw ApiException.validation("Seats must be 1-8.", Map.of("capacity", "Seats must be 1-8."));
            }
            // Shrinking a station under the people already sitting at it is not a config edit.
            PlaySession active = sessions.findActiveByDevice(device.getId()).orElse(null);
            if (active != null) {
                int seated = players.findBySession(active.getId()).stream()
                        .mapToInt(p -> p.getTicket().getSeatsPerTicket()).sum();
                if (seated > capacity) {
                    throw ApiException.conflict(ErrorCode.INVALID_TRANSITION,
                            "More players are on it right now than that.");
                }
            }
            device.setCapacity((short) capacity);
        }
        if (Boolean.TRUE.equals(input.active()) && !device.isActive()) {
            device.setActive(true);
            device.setStatus(DeviceStatus.AVAILABLE);
            device.setStatusReason(null);
            device.setStatusChangedAt(now);
        }
        devices.save(device);

        audit.record(actor.id(), "DEVICE_UPDATED", "device", device.getId(), device.getCode(), before,
                Map.of("label", device.getLabel(), "locationNote", device.getLocationNote(),
                        "capacity", (int) device.getCapacity(), "active", device.isActive()));
        live.deviceUpdated(device.getId(), device.getCode(), device.getStatus(), device.getStatusReason());
        return toDto(device, List.of(), EventDay.of(now, settings.get().getTimezone()), now);
    }

    /** Soft delete. A station with a session on it is refused, not quietly emptied (docs/02 E7). */
    @Transactional
    public void deactivate(Long id, CurrentUser actor) {
        Device device = devices.findById(id).orElseThrow(() -> ApiException.notFound("Device"));
        if (device.getStatus() == DeviceStatus.IN_USE) {
            throw ApiException.conflict(ErrorCode.INVALID_TRANSITION,
                    device.getCode() + " has a session running. End it first.");
        }
        device.setActive(false);
        devices.save(device);
        audit.record(actor.id(), "DEVICE_DEACTIVATED", "device", device.getId(), device.getCode(),
                Map.of("active", true), Map.of("active", false));
        live.deviceUpdated(device.getId(), device.getCode(), device.getStatus(), device.getStatusReason());
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
    }

    // ── device types ─────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<DeviceTypeDto> listTypes() {
        return types.findAll().stream()
                .sorted(Comparator.comparing(DeviceType::getSortOrder))
                .map(AdminDeviceService::toDto)
                .toList();
    }

    @Transactional
    public DeviceTypeDto createType(DeviceTypeInput input, CurrentUser actor) {
        Map<String, String> errors = new LinkedHashMap<>();
        String code = input.code() == null ? "" : input.code().trim().toUpperCase(Locale.ROOT);
        if (!TYPE_CODE.matcher(code).matches()) errors.put("code", "2-6 letters or digits, e.g. VR.");
        else if (types.existsByCode(code)) errors.put("code", code + " already exists.");
        String name = input.name() == null ? "" : input.name().trim();
        if (name.length() < 2) errors.put("name", "Give it a name.");
        int capacity = input.defaultCapacity();
        if (capacity < 1 || capacity > 8) errors.put("defaultCapacity", "Seats must be 1-8.");
        if (!errors.isEmpty()) throw ApiException.validation(errors.values().iterator().next(), errors);

        DeviceType type = new DeviceType();
        type.setCode(code);
        type.setName(name);
        type.setIcon(blankTo(input.icon(), "monitor"));
        type.setDefaultCapacity((short) capacity);
        type.setSortOrder((short) (types.count() + 1));
        types.save(type);

        audit.record(actor.id(), "DEVICE_TYPE_CREATED", "device_type", type.getId(), type.getCode(), null,
                Map.of("name", name, "defaultCapacity", capacity));
        live.publish(LiveEvent.Type.SETTINGS_UPDATED, Map.of());
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
        return toDto(type);
    }

    @Transactional
    public DeviceTypeDto updateType(Long id, DeviceTypeInput input, CurrentUser actor) {
        DeviceType type = types.findById(id).orElseThrow(() -> ApiException.notFound("Device type"));
        Map<String, Object> before = Map.of("name", type.getName(), "icon", type.getIcon(),
                "defaultCapacity", (int) type.getDefaultCapacity());
        if (input.name() != null && !input.name().isBlank()) type.setName(input.name().trim());
        if (input.icon() != null && !input.icon().isBlank()) type.setIcon(input.icon().trim());
        if (input.defaultCapacity() > 0) type.setDefaultCapacity((short) Math.min(8, input.defaultCapacity()));
        types.save(type);
        audit.record(actor.id(), "DEVICE_TYPE_UPDATED", "device_type", type.getId(), type.getCode(), before,
                Map.of("name", type.getName(), "icon", type.getIcon(),
                        "defaultCapacity", (int) type.getDefaultCapacity()));
        live.publish(LiveEvent.Type.SETTINGS_UPDATED, Map.of());
        return toDto(type);
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    static DeviceTypeDto toDto(DeviceType t) {
        return new DeviceTypeDto(t.getId(), t.getCode(), t.getName(), t.getIcon(),
                t.getDefaultCapacity(), t.getSortOrder(), t.isActive());
    }

    private AdminDeviceDto toDto(Device d, List<PlaySession> today, EventDay day, Instant now) {
        CurrentSessionRef current = null;
        if (d.getStatus() == DeviceStatus.IN_USE) {
            current = sessions.findActiveByDevice(d.getId())
                    .map(s -> new CurrentSessionRef(
                            players.findBySession(s.getId()).stream()
                                    .map(p -> p.getTicket().getTicketNo()).toList(),
                            s.getPlannedEndAt()))
                    .orElse(null);
        }
        return new AdminDeviceDto(d.getId(), d.getCode(), d.getLabel(), d.getLocationNote(),
                d.getDeviceType().getId(), d.getDeviceType().getCode(), d.getCapacity(),
                d.getStatus(), d.getStatusReason(), d.isActive(), current,
                uptimePct(d, day, now), today.size());
    }

    /**
     * Uptime from the maintenance log alone: walk the day's status changes and add up every
     * stretch spent out of service. No separate counter to drift out of step.
     */
    private double uptimePct(Device device, EventDay day, Instant now) {
        Instant start = device.getCreatedAt() != null && device.getCreatedAt().isAfter(day.from())
                ? device.getCreatedAt() : day.from();
        Instant end = day.endOrNow(now);
        long window = Math.max(1, Duration.between(start, end).toMillis());

        long down = 0;
        Instant downSince = null;
        for (DeviceStatusLog log : statusLog.findByDevice(device.getId())) {
            if (log.getChangedAt().isAfter(end)) break;
            if (log.getToStatus() == DeviceStatus.OUT_OF_SERVICE && downSince == null) {
                downSince = log.getChangedAt().isAfter(start) ? log.getChangedAt() : start;
            } else if (log.getToStatus() != DeviceStatus.OUT_OF_SERVICE && downSince != null) {
                down += Duration.between(downSince, log.getChangedAt()).toMillis();
                downSince = null;
            }
        }
        if (downSince != null) down += Duration.between(downSince, end).toMillis();
        return Math.round((window - Math.min(down, window)) * 1000.0 / window) / 10.0;
    }

    private static Integer suffix(String code) {
        int dash = code.lastIndexOf('-');
        if (dash < 0) return null;
        try {
            return Integer.valueOf(code.substring(dash + 1));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String blankTo(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}

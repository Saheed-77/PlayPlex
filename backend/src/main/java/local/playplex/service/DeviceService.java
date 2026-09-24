package local.playplex.service;

import local.playplex.domain.*;
import local.playplex.error.ApiException;
import local.playplex.error.ErrorCode;
import local.playplex.live.LiveEvent;
import local.playplex.live.LiveEventPublisher;
import local.playplex.repo.DeviceRepository;
import local.playplex.repo.PlaySessionRepository;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Map;

/** Device faults and cleaning, from the floor (docs/02 §7). */
@Service
public class DeviceService {

    private final DeviceRepository devices;
    private final PlaySessionRepository sessions;
    private final SessionService sessionService;
    private final AuditService audit;
    private final QueueEventFactory queueEvents;
    private final LiveEventPublisher live;
    private final Clock clock;

    public DeviceService(DeviceRepository devices, PlaySessionRepository sessions,
                         SessionService sessionService, AuditService audit,
                         QueueEventFactory queueEvents, LiveEventPublisher live, Clock clock) {
        this.devices = devices;
        this.sessions = sessions;
        this.sessionService = sessionService;
        this.audit = audit;
        this.queueEvents = queueEvents;
        this.live = live;
        this.clock = clock;
    }

    @Transactional
    public void changeStatus(Long deviceId, DeviceStatus status, String reason, CurrentUser actor) {
        Device device = devices.findById(deviceId).filter(Device::isActive)
                .orElseThrow(() -> ApiException.notFound("Device"));
        if (status != DeviceStatus.AVAILABLE && status != DeviceStatus.CLEANING
                && status != DeviceStatus.OUT_OF_SERVICE) {
            throw ApiException.validation("Unknown status.", Map.of("status", "Unknown status."));
        }
        if (status == DeviceStatus.OUT_OF_SERVICE && TicketService.isBlank(reason)) {
            throw ApiException.validation("Say what is wrong with it.", Map.of("reason", "Required."));
        }
        if (device.getStatus() == status) return;

        DeviceStatus before = device.getStatus();
        if (device.getStatus() == DeviceStatus.IN_USE) {
            if (status != DeviceStatus.OUT_OF_SERVICE) {
                throw ApiException.conflict(ErrorCode.INVALID_TRANSITION,
                        "End the session on " + device.getCode() + " first.");
            }
            // A fault mid-session ends it as a tech issue: the players go back to the front
            // of the queue and reception is told to offer a refund (docs/02 §7).
            sessions.findActiveByDevice(device.getId()).ifPresent(session -> {
                sessionService.finish(session, EndReason.TECH_ISSUE, reason, actor, false);
                Map<String, Object> ended = Map.of("sessionId", session.getId(),
                        "deviceId", device.getId(), "endReason", EndReason.TECH_ISSUE.name());
                live.publish(LiveEvent.Type.SESSION_ENDED, ended);
            });
        }

        sessionService.changeStatus(device, status, reason, actor.id(), clock.instant());
        audit.record(actor.id(), "DEVICE_STATUS_CHANGED", "device", device.getId(), device.getCode(),
                Map.of("status", before.name()), Map.of("status", status.name(), "reason", String.valueOf(reason)));
        live.deviceUpdated(device.getId(), device.getCode(), status, device.getStatusReason());
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
    }

    /** CLEANING -> AVAILABLE, for when a volunteer has wiped it down early. */
    @Transactional
    public void markReady(Long deviceId, CurrentUser actor) {
        Device device = devices.findById(deviceId).filter(Device::isActive)
                .orElseThrow(() -> ApiException.notFound("Device"));
        if (device.getStatus() != DeviceStatus.CLEANING) {
            throw ApiException.conflict(ErrorCode.INVALID_TRANSITION,
                    device.getCode() + " isn't being cleaned.");
        }
        sessionService.changeStatus(device, DeviceStatus.AVAILABLE, null, actor.id(), clock.instant());
        live.deviceUpdated(device.getId(), device.getCode(), DeviceStatus.AVAILABLE, null);
        live.publish(LiveEvent.Type.QUEUE_UPDATED, queueEvents.payload());
    }
}

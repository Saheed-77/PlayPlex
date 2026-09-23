package local.playplex.service;

import local.playplex.domain.Device;
import local.playplex.domain.DeviceStatus;
import local.playplex.domain.EventSettings;
import local.playplex.domain.PlaySession;
import local.playplex.domain.Ticket;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Wait estimates, ported from the reference implementation in frontend/src/mock/logic.ts.
 *
 * It drains the whole queue across every station: each waiting ticket takes the earliest
 * slot it is eligible for, and the slot then moves on by that ticket's duration. What is
 * left over is when a newcomer would actually get to play — which is the number that steers
 * students towards under-used devices ("PS5 is 22 minutes but a laptop is 8").
 */
public class WaitEstimator {

    private record Slot(Long deviceTypeId, Instant at) { }

    private final List<Slot> slots = new ArrayList<>();
    private final Map<Long, Instant> ticketStart = new HashMap<>();
    private final Instant now;

    public WaitEstimator(Instant now, List<Device> devices, Map<Long, PlaySession> sessionsByDevice,
                         List<Ticket> queue, EventSettings settings) {
        this.now = now;
        Duration cleaning = Duration.ofSeconds(settings.getCleaningAutoClearSeconds());

        for (Device device : devices) {
            if (device.getStatus() == DeviceStatus.OUT_OF_SERVICE) continue;
            Instant free = now;
            if (device.getStatus() == DeviceStatus.CLEANING) {
                free = max(now, device.getStatusChangedAt().plus(cleaning));
            } else if (device.getStatus() == DeviceStatus.IN_USE) {
                PlaySession session = sessionsByDevice.get(device.getId());
                Instant endsAt = now;
                if (session != null) {
                    // A paused session is assumed to resume right now: never promise a held
                    // station sooner than it can free up (docs/02 §8).
                    endsAt = session.getPausedAt() != null
                            ? now.plus(Duration.between(session.getPausedAt(), session.getPlannedEndAt()))
                            : session.getPlannedEndAt();
                }
                free = max(now.plus(Duration.ofMinutes(1)), endsAt.plus(cleaning));
            }
            slots.add(new Slot(device.getDeviceType().getId(), free));
        }

        for (Ticket ticket : queue) {
            int best = -1;
            for (int i = 0; i < slots.size(); i++) {
                Slot slot = slots.get(i);
                Long preferred = ticket.getPreferredDeviceType() == null ? null : ticket.getPreferredDeviceType().getId();
                if (preferred != null && !preferred.equals(slot.deviceTypeId())) continue;
                if (best < 0 || slot.at().isBefore(slots.get(best).at())) best = i;
            }
            if (best < 0) continue;
            Slot chosen = slots.get(best);
            ticketStart.put(ticket.getId(), chosen.at());
            slots.set(best, new Slot(chosen.deviceTypeId(),
                    chosen.at().plus(Duration.ofMinutes(ticket.getDurationMinutesSnapshot())).plus(cleaning)));
        }
    }

    /** Minutes until a newcomer would get on this device type; -1 when none can serve them. */
    public int waitForType(Long deviceTypeId) {
        Instant earliest = null;
        for (Slot slot : slots) {
            if (deviceTypeId != null && !deviceTypeId.equals(slot.deviceTypeId())) continue;
            if (earliest == null || slot.at().isBefore(earliest)) earliest = slot.at();
        }
        return earliest == null ? -1 : minutesFromNow(earliest);
    }

    /** Minutes until this already-queued ticket is likely to start, or null if nothing fits. */
    public Integer waitForTicket(Long ticketId) {
        Instant at = ticketStart.get(ticketId);
        return at == null ? null : minutesFromNow(at);
    }

    private int minutesFromNow(Instant at) {
        long minutes = Math.round(Duration.between(now, at).toMillis() / 60000.0);
        return (int) Math.max(0, minutes);
    }

    private static Instant max(Instant a, Instant b) { return a.isAfter(b) ? a : b; }
}

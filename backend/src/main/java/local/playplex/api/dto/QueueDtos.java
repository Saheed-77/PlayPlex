package local.playplex.api.dto;

import local.playplex.domain.PaymentStatus;

import java.time.Instant;
import java.util.List;

public class QueueDtos {

    /**
     * Same endpoint, different DTO by role (docs/04 §5): `fullName` and `phone` are filled
     * in for reception and admin and left null for volunteers, so a volunteer physically
     * cannot receive a phone number however the UI is written.
     */
    public record QueueItemDto(int position, Long ticketId, String ticketNo, String displayName,
                               String fullName, String phone, String planName, int durationMinutes,
                               int seatsPerTicket, Long preferredDeviceTypeId, String preferredDeviceTypeCode,
                               int priority, Instant queuedAt, int waitingMinutes,
                               PaymentStatus paymentStatus) { }

    public record QueueResponse(Instant serverTime, Long deviceTypeId, List<QueueItemDto> items) { }
}

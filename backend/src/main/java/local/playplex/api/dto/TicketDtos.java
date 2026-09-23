package local.playplex.api.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import local.playplex.domain.PaymentKind;
import local.playplex.domain.PaymentMethod;
import local.playplex.domain.PaymentStatus;
import local.playplex.domain.TicketStatus;

import java.time.Instant;
import java.util.List;

public class TicketDtos {

    public record StudentInput(
            @NotBlank(message = "Enter the student's name.") @Size(max = 100) String fullName,
            @NotBlank @Pattern(regexp = "[6-9]\\d{9}", message = "Enter a 10-digit mobile number.") String phone,
            @Size(max = 30) String rollNo,
            @Size(max = 60) String department,
            Short yearOfStudy) { }

    public record PaymentInput(@NotNull(message = "Choose how they paid.") PaymentMethod method,
                               int amountPaise, String referenceNo, String note) { }

    /** Register and pay in one call — one transaction, or nothing (docs/04 §4). */
    public record CreateTicketRequest(@Valid StudentInput student, Long studentId,
                                      @NotNull(message = "Choose a plan.") Long planId,
                                      Long preferredDeviceTypeId,
                                      @Valid @NotNull PaymentInput payment,
                                      String notes) { }

    public record StudentRef(Long id, String fullName, String phone, String rollNo) { }

    public record PlanRef(Long id, String name, int durationMinutes, int pricePaise) { }

    public record DeviceTypeRef(Long id, String code, String name) { }

    public record TicketDto(Long id, String ticketNo, StudentRef student, PlanRef plan,
                            DeviceTypeRef preferredDeviceType, TicketStatus status,
                            PaymentStatus paymentStatus, int priority, Instant queuedAt,
                            Instant assignedAt, Instant completedAt, Instant cancelledAt,
                            int noShowCount, String notes, int balancePaise, int amountDuePaise,
                            String deviceCode, String registeredByName, Integer queuePosition,
                            Integer estimatedWaitMinutes) { }

    public record PaymentDto(Long id, int amountPaise, PaymentKind kind, PaymentMethod method,
                             String referenceNo, String collectedByName, Instant collectedAt,
                             String note) { }

    public record StudentDto(Long id, String fullName, String phone, String rollNo, String department,
                             Short yearOfStudy, int visitCount, String activeTicketNo) { }

    public record PageDto<T>(List<T> content, int page, int size, long totalElements, int totalPages) { }
}

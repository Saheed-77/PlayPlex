package local.playplex.service;

import local.playplex.api.dto.TicketDtos.*;
import local.playplex.domain.*;
import local.playplex.error.ApiException;
import local.playplex.error.ErrorCode;
import local.playplex.repo.*;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Registration: the most-used path in the whole system (docs/04 §4). */
@Service
public class TicketService {

    private final TicketRepository tickets;
    private final StudentRepository students;
    private final PlanRepository plans;
    private final DeviceTypeRepository deviceTypes;
    private final PaymentRepository payments;
    private final PlaySessionPlayerRepository playerRepo;
    private final DeviceRepository devices;
    private final StaffUserRepository users;
    private final SeqCounterRepository seq;
    private final SettingsService settingsService;
    private final Clock clock;

    public TicketService(TicketRepository tickets, StudentRepository students, PlanRepository plans,
                         DeviceTypeRepository deviceTypes, PaymentRepository payments,
                         PlaySessionPlayerRepository playerRepo, DeviceRepository devices,
                         StaffUserRepository users, SeqCounterRepository seq,
                         SettingsService settingsService, Clock clock) {
        this.tickets = tickets;
        this.students = students;
        this.plans = plans;
        this.deviceTypes = deviceTypes;
        this.payments = payments;
        this.playerRepo = playerRepo;
        this.devices = devices;
        this.users = users;
        this.seq = seq;
        this.settingsService = settingsService;
        this.clock = clock;
    }

    /**
     * Upsert the student, snapshot the price onto the ticket, record the payment — all in
     * one transaction. If any step fails nothing is written: a student is never charged for
     * a ticket that doesn't exist, and a ticket never exists unpaid.
     */
    @Transactional
    public TicketDto create(CreateTicketRequest request, CurrentUser actor) {
        Instant now = clock.instant();
        Map<String, String> errors = new LinkedHashMap<>();

        Plan plan = plans.findById(request.planId()).filter(Plan::isActive).orElse(null);
        if (plan == null) errors.put("planId", "Choose a plan.");

        PaymentMethod method = request.payment().method();
        if (method == PaymentMethod.WAIVED && isBlank(request.payment().note())) {
            errors.put("payment.note", "Say why this ticket is free.");
        }
        if (plan != null && method != PaymentMethod.WAIVED
                && request.payment().amountPaise() != plan.getPricePaise()) {
            errors.put("payment.amountPaise", "The amount must match the plan price.");
        }

        DeviceType preferred = null;
        if (request.preferredDeviceTypeId() != null) {
            preferred = deviceTypes.findById(request.preferredDeviceTypeId())
                    .filter(DeviceType::isActive).orElse(null);
            if (preferred == null) errors.put("preferredDeviceTypeId", "Unknown device type.");
        }
        // A device-specific plan (Sim Sprint, Console Duo) pins the preference to its device.
        if (plan != null && !plan.getDeviceTypes().isEmpty()) {
            if (preferred == null && plan.getDeviceTypes().size() == 1) {
                preferred = plan.getDeviceTypes().iterator().next();
            } else if (preferred == null || plan.getDeviceTypes().stream()
                    .noneMatch(t -> t.getId().equals(request.preferredDeviceTypeId()))) {
                String names = plan.getDeviceTypes().stream().map(DeviceType::getName)
                        .reduce((a, b) -> a + " or " + b).orElse("a specific device");
                errors.put("preferredDeviceTypeId", plan.getName() + " can only be played on " + names + ".");
            }
        }
        if (!errors.isEmpty()) {
            throw ApiException.validation(errors.values().iterator().next(), errors);
        }

        Student student = resolveStudent(request, now);
        StaffUser registeredBy = users.getReferenceById(actor.id());

        Ticket ticket = new Ticket();
        ticket.setTicketNo(seq.nextTicketNo());
        ticket.setStudent(student);
        ticket.setPlan(plan);
        ticket.setPlanNameSnapshot(plan.getName());
        ticket.setDurationMinutesSnapshot(plan.getDurationMinutes());
        ticket.setPricePaiseSnapshot(plan.getPricePaise());
        ticket.setSeatsPerTicket(plan.getSeatsPerTicket());
        ticket.setPreferredDeviceType(preferred);
        ticket.setStatus(TicketStatus.QUEUED);
        ticket.setPaymentStatus(method == PaymentMethod.WAIVED ? PaymentStatus.WAIVED : PaymentStatus.PAID);
        ticket.setQueuedAt(now);
        ticket.setCreatedAt(now);
        ticket.setRegisteredBy(registeredBy);
        ticket.setNotes(blankToNull(request.notes()));
        tickets.save(ticket);

        Payment payment = new Payment();
        payment.setTicket(ticket);
        payment.setAmountPaise(method == PaymentMethod.WAIVED ? 0 : plan.getPricePaise());
        payment.setKind(PaymentKind.INITIAL);
        payment.setMethod(method);
        payment.setReferenceNo(blankToNull(request.payment().referenceNo()));
        payment.setCollectedBy(registeredBy);
        payment.setCollectedAt(now);
        payment.setNote(blankToNull(request.payment().note()));
        payments.save(payment);

        return toDto(ticket, now, true);
    }

    private Student resolveStudent(CreateTicketRequest request, Instant now) {
        if (request.studentId() != null) {
            return students.findById(request.studentId()).orElseThrow(() -> ApiException.notFound("Student"));
        }
        StudentInput input = request.student();
        if (input == null) {
            throw ApiException.validation("Enter the student's details.",
                    Map.of("student.phone", "Enter a 10-digit mobile number."));
        }
        // Repeat visitors are matched on phone, and their details refreshed.
        Student student = students.findByPhone(input.phone()).orElseGet(Student::new);
        if (student.getId() == null) {
            student.setPhone(input.phone());
            student.setCreatedAt(now);
        }
        student.setFullName(input.fullName().trim());
        student.setRollNo(blankToNull(input.rollNo()));
        student.setDepartment(blankToNull(input.department()));
        student.setYearOfStudy(input.yearOfStudy());
        return students.save(student);
    }

    @Transactional(readOnly = true)
    public TicketDto get(Long id) {
        Ticket ticket = tickets.findById(id).orElseThrow(() -> ApiException.notFound("Ticket"));
        return toDto(ticket, clock.instant(), true);
    }

    /** Position within the queue this ticket is actually eligible for. */
    @Transactional(readOnly = true)
    public TicketDto toDto(Ticket ticket, Instant now, boolean withQueuePosition) {
        Integer position = null;
        Integer estimate = null;
        if (withQueuePosition && ticket.getStatus() == TicketStatus.QUEUED) {
            Long typeId = ticket.getPreferredDeviceType() == null ? null : ticket.getPreferredDeviceType().getId();
            List<Ticket> queue = tickets.findQueue(typeId);
            for (int i = 0; i < queue.size(); i++) {
                if (queue.get(i).getId().equals(ticket.getId())) { position = i + 1; break; }
            }
            EventSettings settings = settingsService.get();
            List<Device> allDevices = devices.findAllActiveWithType();
            estimate = new WaitEstimator(now, allDevices, Map.of(), tickets.findQueue(null), settings)
                    .waitForTicket(ticket.getId());
        }

        String deviceCode = playerRepo.findByTicket(ticket.getId()).stream()
                .filter(PlaySessionPlayer::isActive)
                .map(p -> p.getSession().getDevice().getCode())
                .findFirst().orElse(null);

        Student s = ticket.getStudent();
        DeviceType pref = ticket.getPreferredDeviceType();
        return new TicketDto(
                ticket.getId(), ticket.getTicketNo(),
                new StudentRef(s.getId(), s.getFullName(), s.getPhone(), s.getRollNo()),
                new PlanRef(ticket.getPlan().getId(), ticket.getPlanNameSnapshot(),
                        ticket.getDurationMinutesSnapshot(), ticket.getPricePaiseSnapshot()),
                pref == null ? null : new DeviceTypeRef(pref.getId(), pref.getCode(), pref.getName()),
                ticket.getStatus(), ticket.getPaymentStatus(), ticket.getPriority(), ticket.getQueuedAt(),
                ticket.getAssignedAt(), ticket.getCompletedAt(), ticket.getCancelledAt(),
                ticket.getNoShowCount(), ticket.getNotes(), payments.balanceOf(ticket.getId()),
                ticket.getAmountDuePaise(), deviceCode, ticket.getRegisteredBy().getFullName(),
                position, estimate);
    }

    @Transactional(readOnly = true)
    public List<StudentDto> search(String query) {
        if (query == null || query.trim().length() < 3) return List.of();
        return students.search(query.trim()).stream().limit(8).map(s -> {
            long visits = tickets.countByStudentIdAndStatusNot(s.getId(), TicketStatus.CANCELLED);
            String active = tickets.findByStatusIn(List.of(TicketStatus.QUEUED, TicketStatus.ASSIGNED)).stream()
                    .filter(t -> t.getStudent().getId().equals(s.getId()))
                    .map(Ticket::getTicketNo).findFirst().orElse(null);
            return new StudentDto(s.getId(), s.getFullName(), s.getPhone(), s.getRollNo(), s.getDepartment(),
                    s.getYearOfStudy(), (int) visits, active);
        }).toList();
    }

    static boolean isBlank(String v) { return v == null || v.isBlank(); }

    static String blankToNull(String v) { return isBlank(v) ? null : v.trim(); }

    static ApiException conflict(ErrorCode code, String detail) { return ApiException.conflict(code, detail); }
}

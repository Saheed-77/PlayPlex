package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;

/** One purchase, one turn. The centre of the model (docs/03 §2.7). */
@Entity
@Table(name = "ticket")
public class Ticket {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** PPX-0042. Human-readable, printed, spoken aloud. */
    @Column(name = "ticket_no", nullable = false, unique = true, length = 12)
    private String ticketNo;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private Student student;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "plan_id", nullable = false)
    private Plan plan;

    // Frozen at sale time so later price edits never rewrite history (ADR-005).
    @Column(name = "plan_name_snapshot", nullable = false, length = 60)
    private String planNameSnapshot;

    @Column(name = "duration_minutes_snapshot", nullable = false)
    private short durationMinutesSnapshot;

    @Column(name = "price_paise_snapshot", nullable = false)
    private int pricePaiseSnapshot;

    @Column(name = "seats_per_ticket", nullable = false)
    private short seatsPerTicket = 1;

    /** null = any device, which is the fastest option for the student. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "preferred_device_type_id")
    private DeviceType preferredDeviceType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TicketStatus status = TicketStatus.QUEUED;

    @Enumerated(EnumType.STRING)
    @Column(name = "payment_status", nullable = false, length = 20)
    private PaymentStatus paymentStatus = PaymentStatus.PAID;

    /** Outstanding either way: money owed to the desk, or owed back to the student. */
    @Column(name = "amount_due_paise", nullable = false)
    private int amountDuePaise = 0;

    /** Higher jumps the queue. Every bump is audit-logged (docs/02 §6.1). */
    @Column(nullable = false)
    private short priority = 0;

    /** The queue ordering key. Preserved across a NO_SHOW -> QUEUED requeue. */
    @Column(name = "queued_at", nullable = false)
    private Instant queuedAt;

    @Column(name = "assigned_at")
    private Instant assignedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Column(name = "no_show_count", nullable = false)
    private short noShowCount = 0;

    @Column(name = "skipped_count", nullable = false)
    private short skippedCount = 0;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "registered_by_user_id", nullable = false)
    private StaffUser registeredBy;

    @Column(length = 300)
    private String notes;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTicketNo() { return ticketNo; }
    public void setTicketNo(String ticketNo) { this.ticketNo = ticketNo; }
    public Student getStudent() { return student; }
    public void setStudent(Student student) { this.student = student; }
    public Plan getPlan() { return plan; }
    public void setPlan(Plan plan) { this.plan = plan; }
    public String getPlanNameSnapshot() { return planNameSnapshot; }
    public void setPlanNameSnapshot(String v) { this.planNameSnapshot = v; }
    public short getDurationMinutesSnapshot() { return durationMinutesSnapshot; }
    public void setDurationMinutesSnapshot(short v) { this.durationMinutesSnapshot = v; }
    public int getPricePaiseSnapshot() { return pricePaiseSnapshot; }
    public void setPricePaiseSnapshot(int v) { this.pricePaiseSnapshot = v; }
    public short getSeatsPerTicket() { return seatsPerTicket; }
    public void setSeatsPerTicket(short v) { this.seatsPerTicket = v; }
    public DeviceType getPreferredDeviceType() { return preferredDeviceType; }
    public void setPreferredDeviceType(DeviceType v) { this.preferredDeviceType = v; }
    public TicketStatus getStatus() { return status; }
    public void setStatus(TicketStatus status) { this.status = status; }
    public PaymentStatus getPaymentStatus() { return paymentStatus; }
    public void setPaymentStatus(PaymentStatus v) { this.paymentStatus = v; }
    public int getAmountDuePaise() { return amountDuePaise; }
    public void setAmountDuePaise(int v) { this.amountDuePaise = v; }
    public short getPriority() { return priority; }
    public void setPriority(short priority) { this.priority = priority; }
    public Instant getQueuedAt() { return queuedAt; }
    public void setQueuedAt(Instant queuedAt) { this.queuedAt = queuedAt; }
    public Instant getAssignedAt() { return assignedAt; }
    public void setAssignedAt(Instant assignedAt) { this.assignedAt = assignedAt; }
    public Instant getCompletedAt() { return completedAt; }
    public void setCompletedAt(Instant completedAt) { this.completedAt = completedAt; }
    public Instant getCancelledAt() { return cancelledAt; }
    public void setCancelledAt(Instant cancelledAt) { this.cancelledAt = cancelledAt; }
    public short getNoShowCount() { return noShowCount; }
    public void setNoShowCount(short v) { this.noShowCount = v; }
    public short getSkippedCount() { return skippedCount; }
    public void setSkippedCount(short v) { this.skippedCount = v; }
    public StaffUser getRegisteredBy() { return registeredBy; }
    public void setRegisteredBy(StaffUser registeredBy) { this.registeredBy = registeredBy; }
    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}

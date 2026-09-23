package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * Append-only ledger. A refund is a new row with a negative amount, never an update —
 * it is the only structure that survives an argument about what happened at 3:15 pm.
 */
@Entity
@Table(name = "payment")
public class Payment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "ticket_id", nullable = false)
    private Ticket ticket;

    @Column(name = "amount_paise", nullable = false)
    private int amountPaise;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private PaymentKind kind;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private PaymentMethod method;

    @Column(name = "reference_no", length = 60)
    private String referenceNo;

    /** Who touched the money: the first place to look if the box is off at close. */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "collected_by_user_id", nullable = false)
    private StaffUser collectedBy;

    @Column(name = "collected_at", nullable = false)
    private Instant collectedAt;

    @Column(length = 200)
    private String note;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Ticket getTicket() { return ticket; }
    public void setTicket(Ticket ticket) { this.ticket = ticket; }
    public int getAmountPaise() { return amountPaise; }
    public void setAmountPaise(int amountPaise) { this.amountPaise = amountPaise; }
    public PaymentKind getKind() { return kind; }
    public void setKind(PaymentKind kind) { this.kind = kind; }
    public PaymentMethod getMethod() { return method; }
    public void setMethod(PaymentMethod method) { this.method = method; }
    public String getReferenceNo() { return referenceNo; }
    public void setReferenceNo(String referenceNo) { this.referenceNo = referenceNo; }
    public StaffUser getCollectedBy() { return collectedBy; }
    public void setCollectedBy(StaffUser collectedBy) { this.collectedBy = collectedBy; }
    public Instant getCollectedAt() { return collectedAt; }
    public void setCollectedAt(Instant collectedAt) { this.collectedAt = collectedAt; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
}

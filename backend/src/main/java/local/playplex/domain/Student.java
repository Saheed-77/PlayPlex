package local.playplex.domain;

import jakarta.persistence.*;
import java.time.Instant;

/** Minimum data only: name, phone, roll number (docs/01 §8). */
@Entity
@Table(name = "student")
public class Student {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "full_name", nullable = false, length = 100)
    private String fullName;

    /** The natural key: what reception types to auto-fill a returning student. */
    @Column(nullable = false, unique = true, length = 15)
    private String phone;

    @Column(name = "roll_no", length = 30)
    private String rollNo;

    @Column(length = 60)
    private String department;

    @Column(name = "year_of_study")
    private Short yearOfStudy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }
    public String getPhone() { return phone; }
    public void setPhone(String phone) { this.phone = phone; }
    public String getRollNo() { return rollNo; }
    public void setRollNo(String rollNo) { this.rollNo = rollNo; }
    public String getDepartment() { return department; }
    public void setDepartment(String department) { this.department = department; }
    public Short getYearOfStudy() { return yearOfStudy; }
    public void setYearOfStudy(Short yearOfStudy) { this.yearOfStudy = yearOfStudy; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}

package local.playplex.repo;

import local.playplex.domain.Student;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface StudentRepository extends JpaRepository<Student, Long> {

    Optional<Student> findByPhone(String phone);

    /** Reception's lookup: phone, name or roll number (docs/04 §4). */
    @Query("""
            select s from Student s
            where s.phone like concat(:q, '%')
               or lower(s.fullName) like lower(concat('%', :q, '%'))
               or lower(s.rollNo) like lower(concat(:q, '%'))
            order by case when s.phone = :q then 0 else 1 end, s.fullName
            """)
    List<Student> search(String q);
}

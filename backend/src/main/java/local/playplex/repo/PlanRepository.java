package local.playplex.repo;

import local.playplex.domain.Plan;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface PlanRepository extends JpaRepository<Plan, Long> {

    @Query("select distinct p from Plan p left join fetch p.deviceTypes where p.active = true order by p.sortOrder")
    List<Plan> findActiveWithTypes();

    @Query("select distinct p from Plan p left join fetch p.deviceTypes order by p.sortOrder")
    List<Plan> findAllWithTypes();

    boolean existsByNameIgnoreCase(String name);
}

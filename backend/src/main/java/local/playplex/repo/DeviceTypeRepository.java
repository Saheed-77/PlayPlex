package local.playplex.repo;

import local.playplex.domain.DeviceType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DeviceTypeRepository extends JpaRepository<DeviceType, Long> {
    List<DeviceType> findByActiveTrueOrderBySortOrderAsc();
    Optional<DeviceType> findByCode(String code);
    boolean existsByCode(String code);
}

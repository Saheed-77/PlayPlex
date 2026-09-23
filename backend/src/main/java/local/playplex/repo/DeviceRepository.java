package local.playplex.repo;

import jakarta.persistence.LockModeType;
import local.playplex.domain.Device;
import local.playplex.domain.DeviceStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface DeviceRepository extends JpaRepository<Device, Long> {

    @Query("select d from Device d join fetch d.deviceType where d.active = true order by d.code")
    List<Device> findAllActiveWithType();

    @Query("select d from Device d join fetch d.deviceType order by d.code")
    List<Device> findAllWithType();

    List<Device> findByActiveTrueAndStatus(DeviceStatus status);

    Optional<Device> findByCode(String code);

    boolean existsByCode(String code);

    /**
     * SELECT ... FOR UPDATE. Taken before every assign so two volunteers tapping at the
     * same instant queue up behind each other instead of racing (docs/02 §4.2). The unique
     * index on the generated column is the backstop if this is ever bypassed.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from Device d where d.id = :id")
    Optional<Device> findByIdForUpdate(Long id);
}

package local.playplex.repo;

import local.playplex.domain.DeviceStatusLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;

public interface DeviceStatusLogRepository extends JpaRepository<DeviceStatusLog, Long> {

    @Query("select l from DeviceStatusLog l where l.device.id = :deviceId order by l.changedAt")
    List<DeviceStatusLog> findByDevice(Long deviceId);

    @Query("select l from DeviceStatusLog l join fetch l.device where l.changedAt < :to order by l.changedAt")
    List<DeviceStatusLog> findChangedBefore(Instant to);
}

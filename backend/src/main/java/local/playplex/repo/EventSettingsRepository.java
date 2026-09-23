package local.playplex.repo;

import local.playplex.domain.EventSettings;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EventSettingsRepository extends JpaRepository<EventSettings, Short> {
}

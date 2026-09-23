package local.playplex.repo;

import local.playplex.domain.PlaySessionEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PlaySessionEventRepository extends JpaRepository<PlaySessionEvent, Long> {
}

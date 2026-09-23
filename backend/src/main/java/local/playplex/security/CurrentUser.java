package local.playplex.security;

import local.playplex.domain.Role;

/** The authenticated principal: just enough to authorise without a database hit. */
public record CurrentUser(Long id, String username, Role role) {
}

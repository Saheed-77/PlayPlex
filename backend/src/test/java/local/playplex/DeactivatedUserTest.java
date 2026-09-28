package local.playplex;

import jakarta.servlet.http.Cookie;
import local.playplex.api.dto.AdminDtos.StaffInput;
import local.playplex.api.dto.AdminDtos.StaffUpdate;
import local.playplex.api.dto.AdminDtos.TemporaryPassword;
import local.playplex.domain.Role;
import local.playplex.domain.StaffUser;
import local.playplex.repo.StaffUserRepository;
import local.playplex.security.CurrentUser;
import local.playplex.security.JwtService;
import local.playplex.service.StaffService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Deactivating someone has to take effect on their *next request*, not whenever their token
 * happens to expire — a volunteer sent home at 8pm must not still be able to end sessions.
 * The filter re-reads the row every request, which is why this works.
 */
@AutoConfigureMockMvc
class DeactivatedUserTest extends IntegrationTestBase {

    @Autowired MockMvc mvc;
    @Autowired StaffService staff;
    @Autowired StaffUserRepository users;
    @Autowired JwtService jwt;

    private static final CurrentUser ADMIN = new CurrentUser(1L, "admin", Role.ADMIN);

    @Test
    void aDeactivatedVolunteersTokenStopsWorkingImmediately() throws Exception {
        TemporaryPassword created = staff.create(
                new StaffInput("anita.s", "Anita S", Role.VOLUNTEER), ADMIN);
        StaffUser user = users.findById(created.user().id()).orElseThrow();
        Cookie session = new Cookie("ppx_session", jwt.issue(user));

        mvc.perform(get("/api/auth/me").cookie(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.username").value("anita.s"));

        staff.update(user.getId(), new StaffUpdate(null, null, false), ADMIN);

        mvc.perform(get("/api/auth/me").cookie(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("NOT_AUTHENTICATED"));
    }

    @Test
    void aVolunteerCannotReachTheAdminSurfaceAtAll() throws Exception {
        TemporaryPassword created = staff.create(
                new StaffInput("deepa.v", "Deepa V", Role.VOLUNTEER), ADMIN);
        StaffUser user = users.findById(created.user().id()).orElseThrow();
        Cookie session = new Cookie("ppx_session", jwt.issue(user));

        mvc.perform(get("/api/admin/reports/summary").cookie(session))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("INSUFFICIENT_ROLE"));
        mvc.perform(get("/api/admin/users").cookie(session)).andExpect(status().isForbidden());
    }
}

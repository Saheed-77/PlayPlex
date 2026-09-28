package local.playplex;

import local.playplex.api.dto.AdminDtos.*;
import local.playplex.api.dto.TicketDtos.CreateTicketRequest;
import local.playplex.api.dto.TicketDtos.PaymentInput;
import local.playplex.api.dto.TicketDtos.StudentInput;
import local.playplex.api.dto.TicketDtos.TicketDto;
import local.playplex.domain.*;
import local.playplex.error.ApiException;
import local.playplex.error.ErrorCode;
import local.playplex.repo.DeviceRepository;
import local.playplex.repo.StaffUserRepository;
import local.playplex.repo.TicketRepository;
import local.playplex.security.CurrentUser;
import local.playplex.service.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The admin surface: what a price edit must not do, and what a busy station must refuse. */
class AdminConfigTest extends IntegrationTestBase {

    @Autowired AdminDeviceService adminDevices;
    @Autowired PlanService plans;
    @Autowired StaffService staff;
    @Autowired AdminSettingsService settingsUpdates;
    @Autowired TicketService tickets;
    @Autowired SessionService sessions;
    @Autowired DeviceRepository devices;
    @Autowired TicketRepository ticketRepo;
    @Autowired StaffUserRepository users;
    @Autowired PasswordEncoder encoder;

    private static final CurrentUser ADMIN = new CurrentUser(1L, "admin", Role.ADMIN);
    private static final AtomicInteger PHONE = new AtomicInteger(500);
    /** Seeded device types: PS5 = 1, PC = 2, SIM = 3, LAP = 4. */
    private static final long LAP = 4L;

    @Test
    void aPriceEditLeavesAlreadySoldTicketsOnTheirSnapshot() {
        PlanDto plan = plans.create(new PlanInput("Sponsor slot", 20, 4000, "", List.of(LAP), 1, true), ADMIN);
        TicketDto sold = register(plan.id(), 4000);
        assertThat(sold.balancePaise()).as("the money actually taken").isEqualTo(4000);

        plans.update(plan.id(), new PlanInput("Sponsor slot", 20, 0, "Free for the last hour",
                List.of(LAP), 1, true), ADMIN);

        Ticket reloaded = ticketRepo.findById(sold.id()).orElseThrow();
        assertThat(reloaded.getPricePaiseSnapshot())
                .as("history is not rewritten when the price changes (ADR-005)")
                .isEqualTo(4000);
        // The next sale gets the new price, and the old one stops counting as "sold at this price".
        TicketDto free = register(plan.id(), 0);
        assertThat(ticketRepo.findById(free.id()).orElseThrow().getPricePaiseSnapshot()).isZero();
        assertThat(plans.listAll().stream().filter(p -> p.id().equals(plan.id())).findFirst()
                .orElseThrow().ticketsSold()).isEqualTo(1);
    }

    @Test
    void aStationWithAGameOnItCannotBeRetired() {
        Device device = devices.findByCode("LAP-10").orElseThrow();
        TicketDto ticket = register(2L, 5000);
        sessions.start(new local.playplex.api.dto.SessionDtos.StartSessionRequest(
                device.getId(), List.of(ticket.id()), SkipReason.OTHER), ADMIN);

        assertThatThrownBy(() -> adminDevices.deactivate(device.getId(), ADMIN))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).code()).isEqualTo(ErrorCode.INVALID_TRANSITION);
        assertThat(devices.findByCode("LAP-10").orElseThrow().isActive()).isTrue();

        // And the seats cannot be shrunk below the people sitting there either.
        assertThatThrownBy(() -> adminDevices.update(device.getId(),
                new DeviceUpdate(null, null, 0, null), ADMIN))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void aNewStationGetsTheNextFreeCodeAndJoinsTheFloor() {
        SuggestedCode suggested = adminDevices.suggestCode(LAP);
        assertThat(suggested.code()).matches("LAP-\\d{2}");

        AdminDeviceDto created = adminDevices.create(
                new DeviceInput(LAP, suggested.code(), "", "Near the door", 1), ADMIN);
        assertThat(created.status()).isEqualTo(DeviceStatus.AVAILABLE);
        assertThat(created.label()).as("a blank label is filled in, not left empty").isNotBlank();

        // The same code twice is a validation failure, not a second station.
        assertThatThrownBy(() -> adminDevices.create(
                new DeviceInput(LAP, suggested.code(), "", "", 1), ADMIN))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).code()).isEqualTo(ErrorCode.VALIDATION_FAILED);
    }

    @Test
    void aVolunteerAccountIsCreatedWithAOneTimePasswordAndAdminCannotDemoteThemselves() {
        TemporaryPassword created = staff.create(
                new StaffInput("ravi.k", "Ravi Kumar", Role.VOLUNTEER), ADMIN);
        assertThat(created.temporaryPassword()).startsWith("ppx-");
        assertThat(created.user().mustChangePassword()).isTrue();

        StaffUser stored = users.findByUsername("ravi.k").orElseThrow();
        assertThat(stored.getPasswordHash()).doesNotContain(created.temporaryPassword());
        assertThat(encoder.matches(created.temporaryPassword(), stored.getPasswordHash())).isTrue();

        // A reset issues a different password and asks for a change again.
        PasswordReset reset = staff.resetPassword(stored.getId(), ADMIN);
        assertThat(reset.temporaryPassword()).isNotEqualTo(created.temporaryPassword());
        assertThat(users.findById(stored.getId()).orElseThrow().isMustChangePassword()).isTrue();

        assertThatThrownBy(() -> staff.update(ADMIN.id(),
                new StaffUpdate(null, Role.VOLUNTEER, null), ADMIN))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).code()).isEqualTo(ErrorCode.BUSINESS_RULE_VIOLATED);
    }

    @Test
    void settingsRangesAreEnforcedOnTheServerNotJustTheForm() {
        assertThatThrownBy(() -> settingsUpdates.update(
                new SettingsInput("PlayPlex", 5, 90, 99, true, 30, 0), ADMIN))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).code()).isEqualTo(ErrorCode.VALIDATION_FAILED);

        var saved = settingsUpdates.update(new SettingsInput("Tech Fest 2026", 7, 120, 5, true, 30, 500000), ADMIN);
        assertThat(saved.eventName()).isEqualTo("Tech Fest 2026");
        assertThat(saved.warningThresholdMinutes()).isEqualTo(7);
    }

    private TicketDto register(long planId, int pricePaise) {
        boolean free = pricePaise == 0;
        return tickets.create(new CreateTicketRequest(
                new StudentInput("Admin Tester " + PHONE.get(), phone("96"), null, null, null),
                null, planId, LAP,
                new PaymentInput(free ? PaymentMethod.WAIVED : PaymentMethod.CASH, pricePaise, null,
                        free ? "Sponsored" : null), null), ADMIN);
    }

    private static String phone(String prefix) {
        return prefix + String.format("%08d", PHONE.incrementAndGet());
    }
}

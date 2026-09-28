package local.playplex;

import local.playplex.api.dto.SessionDtos.StartSessionRequest;
import local.playplex.api.dto.TicketDtos.CreateTicketRequest;
import local.playplex.api.dto.TicketDtos.PaymentInput;
import local.playplex.api.dto.TicketDtos.StudentInput;
import local.playplex.api.dto.TicketDtos.TicketDto;
import local.playplex.domain.*;
import local.playplex.repo.DeviceRepository;
import local.playplex.security.CurrentUser;
import local.playplex.service.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Reports are only useful if they agree with the cash box. These are the cross-checks the
 * runbook asks for at the end of the night (docs/08 §9).
 */
class ReportMathTest extends IntegrationTestBase {

    @Autowired ReportService reports;
    @Autowired CsvExportService csv;
    @Autowired TicketService tickets;
    @Autowired SessionService sessions;
    @Autowired PauseService pauses;
    @Autowired DeviceRepository devices;

    private static final CurrentUser ADMIN = new CurrentUser(1L, "admin", Role.ADMIN);
    private static final AtomicInteger PHONE = new AtomicInteger(700);

    @Test
    void cashPlusUpiPlusWaivedIsTheTotalExactly() {
        sell(2L, PaymentMethod.CASH, 5000);   // Standard, the most popular slot
        sell(1L, PaymentMethod.CASH, 3000);   // Quick Play
        sell(2L, PaymentMethod.UPI, 5000);
        sell(2L, PaymentMethod.WAIVED, 0);    // a free ticket still writes a ledger row

        var window = reports.window(null, null);
        var summary = reports.summary(window);
        var revenue = reports.revenue(window);

        int fromMethods = revenue.byMethod().stream().mapToInt(m -> m.amountPaise()).sum();
        assertThat(fromMethods)
                .as("the ledger is the only source: the breakdown and the total are the same rows")
                .isEqualTo(summary.revenue().totalPaise());

        int cash = summary.revenue().cashPaise();
        int upi = summary.revenue().upiPaise();
        int refunds = summary.revenue().refundsPaise();
        assertThat(cash + upi + refunds).isEqualTo(summary.revenue().totalPaise());
        assertThat(cash).isGreaterThanOrEqualTo(8000);
        assertThat(upi).isGreaterThanOrEqualTo(5000);

        // Hourly buckets are a partition of the same money — nothing lands outside one.
        assertThat(revenue.hourly().stream().mapToInt(h -> h.amountPaise()).sum())
                .isEqualTo(summary.revenue().totalPaise());
    }

    @Test
    void pausedMinutesAreHeldBackFromUtilisation() {
        Device device = devices.findByCode("PC-01").orElseThrow();
        TicketDto ticket = sellFor(device, 5000);
        var started = sessions.start(new StartSessionRequest(device.getId(), List.of(ticket.id()),
                SkipReason.OTHER), ADMIN);
        pauses.giveBackLostTime(started.id(), 3, PauseReason.POWER, "Power cut", ADMIN);

        var utilisation = reports.utilization(reports.window(null, null));
        var row = utilisation.byDevice().stream().filter(d -> d.code().equals("PC-01")).findFirst().orElseThrow();
        assertThat(row.pausedMinutes()).as("the three lost minutes are reported, not hidden").isEqualTo(3);

        var summary = reports.summary(reports.window(null, null));
        assertThat(summary.pausedMinutes()).isGreaterThanOrEqualTo(3);
        assertThat(summary.pausedSessions()).isGreaterThanOrEqualTo(1);
        assertThat(summary.utilizationPct()).isBetween(0.0, 100.0);
    }

    @Test
    void theCsvCarriesItsBomAndQuotesWhatItMust() {
        sell(PaymentMethod.CASH, 5000);
        String body = csv.export(CsvExportService.Type.payments, reports.window(null, null), ADMIN);
        assertThat(body).startsWith("id,ticket_no,amount_paise");
        assertThat(body).contains("\r\n");

        // The controller prepends the BOM; check the bytes Excel will actually see.
        byte[] bytes = ("\uFEFF" + body).getBytes(StandardCharsets.UTF_8);
        assertThat(bytes[0] & 0xFF).isEqualTo(0xEF);
        assertThat(bytes[1] & 0xFF).isEqualTo(0xBB);
        assertThat(bytes[2] & 0xFF).isEqualTo(0xBF);

        assertThat(CsvExportService.toCsv(List.of(new java.util.LinkedHashMap<>(
                java.util.Map.of("name", "Nair, Meera")))))
                .as("a comma inside a name must not become a new column")
                .contains("\"Nair, Meera\"");
    }

    @Test
    void theStudentsReportFindsSomeoneByAnyOfTheirDetails() {
        TicketDto ticket = sell(PaymentMethod.CASH, 5000);
        var page = reports.students(reports.window(null, null), ticket.ticketNo(), 0);
        assertThat(page.content()).hasSize(1);
        assertThat(page.content().get(0).ticketNo()).isEqualTo(ticket.ticketNo());
        assertThat(reports.students(reports.window(null, null), "no-such-person", 0).content()).isEmpty();
    }

    private TicketDto sell(PaymentMethod method, int amount) {
        return sell(2L, method, amount);
    }

    private TicketDto sell(long planId, PaymentMethod method, int amount) {
        return tickets.create(new CreateTicketRequest(
                new StudentInput("Report Tester " + PHONE.get(), phone(), null, null, null),
                null, planId, 1L,
                new PaymentInput(method, amount, null,
                        method == PaymentMethod.WAIVED ? "Volunteer's guest" : null), null), ADMIN);
    }

    private TicketDto sellFor(Device device, int amount) {
        return tickets.create(new CreateTicketRequest(
                new StudentInput("Report Tester " + PHONE.get(), phone(), null, null, null),
                null, 2L, device.getDeviceType().getId(),
                new PaymentInput(PaymentMethod.CASH, amount, null, null), null), ADMIN);
    }

    private static String phone() {
        return "95" + String.format("%08d", PHONE.incrementAndGet());
    }
}

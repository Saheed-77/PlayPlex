package local.playplex.api;

import local.playplex.api.dto.ReportDtos.*;
import local.playplex.api.dto.TicketDtos.PageDto;
import local.playplex.api.dto.TicketDtos.TicketDto;
import local.playplex.security.CurrentUser;
import local.playplex.service.CsvExportService;
import local.playplex.service.ReportService;
import local.playplex.service.ReportWindow;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

/** Reports for the debrief, and the four CSVs that outlive the event (docs/04 §10). */
@RestController
@RequestMapping("/api/admin/reports")
@PreAuthorize("hasRole('ADMIN')")
public class ReportController {

    /** Excel reads a UTF-8 file as its own codepage unless the bytes start with this. */
    private static final byte[] BOM = { (byte) 0xEF, (byte) 0xBB, (byte) 0xBF };

    private final ReportService reports;
    private final CsvExportService csv;

    public ReportController(ReportService reports, CsvExportService csv) {
        this.reports = reports;
        this.csv = csv;
    }

    @GetMapping("/summary")
    public SummaryReport summary(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                 @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return reports.summary(reports.window(from, to));
    }

    @GetMapping("/revenue")
    public RevenueReport revenue(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                 @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return reports.revenue(reports.window(from, to));
    }

    @GetMapping("/utilization")
    public UtilizationReport utilization(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                         @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return reports.utilization(reports.window(from, to));
    }

    @GetMapping("/queue")
    public QueueReport queue(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                             @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return reports.queue(reports.window(from, to));
    }

    @GetMapping("/students")
    public PageDto<TicketDto> students(@RequestParam(required = false) String q,
                                       @RequestParam(defaultValue = "0") int page,
                                       @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                       @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return reports.students(reports.window(from, to), q, page);
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(@RequestParam String type,
                                         @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                         @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                         @AuthenticationPrincipal CurrentUser user) {
        CsvExportService.Type kind = CsvExportService.parseType(type);
        ReportWindow window = reports.window(from, to);
        byte[] body = csv.export(kind, window, user).getBytes(StandardCharsets.UTF_8);
        byte[] withBom = new byte[BOM.length + body.length];
        System.arraycopy(BOM, 0, withBom, 0, BOM.length);
        System.arraycopy(body, 0, withBom, BOM.length, body.length);

        String filename = "playplex-%s-%s.csv".formatted(kind, window.from());
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(filename).build().toString())
                .body(withBom);
    }
}

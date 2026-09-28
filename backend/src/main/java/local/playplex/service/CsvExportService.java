package local.playplex.service;

import local.playplex.domain.*;
import local.playplex.error.ApiException;
import local.playplex.repo.*;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

/**
 * The evening's data as four spreadsheets (docs/04 §10.6). These files carry phone numbers,
 * so every download is written to the audit log — that trail is the whole reason the export
 * is a server endpoint rather than a button that serialises whatever the browser happens to
 * be holding.
 */
@Service
public class CsvExportService {

    public enum Type { students, tickets, sessions, payments }

    private final StudentRepository students;
    private final TicketRepository tickets;
    private final PlaySessionRepository sessions;
    private final PlaySessionPlayerRepository players;
    private final PaymentRepository payments;
    private final AuditService audit;

    public CsvExportService(StudentRepository students, TicketRepository tickets,
                            PlaySessionRepository sessions, PlaySessionPlayerRepository players,
                            PaymentRepository payments, AuditService audit) {
        this.students = students;
        this.tickets = tickets;
        this.sessions = sessions;
        this.players = players;
        this.payments = payments;
        this.audit = audit;
    }

    @Transactional
    public String export(Type type, ReportWindow w, CurrentUser actor) {
        List<Map<String, Object>> rows = switch (type) {
            case students -> studentRows(w);
            case tickets -> ticketRows(w);
            case sessions -> sessionRows(w);
            case payments -> paymentRows(w);
        };
        audit.record(actor.id(), "EXPORT_DOWNLOADED", "report", null, type + ".csv", null,
                Map.of("type", type.name(), "from", w.from().toString(), "to", w.to().toString(),
                        "rows", rows.size()));
        return toCsv(rows);
    }

    public static Type parseType(String raw) {
        try {
            return Type.valueOf(raw == null ? "" : raw.trim());
        } catch (IllegalArgumentException e) {
            throw ApiException.validation("Unknown export type.", Map.of("type", "Unknown export type."));
        }
    }

    // ── row builders ─────────────────────────────────────────────────────────

    private List<Map<String, Object>> studentRows(ReportWindow w) {
        List<Ticket> inWindow = tickets.findCreatedBetween(w.start(), w.end());
        Map<Long, Long> counts = new HashMap<>();
        for (Ticket t : tickets.findAll()) counts.merge(t.getStudent().getId(), 1L, Long::sum);
        Set<Long> seen = new LinkedHashSet<>();
        for (Ticket t : inWindow) seen.add(t.getStudent().getId());

        List<Map<String, Object>> rows = new ArrayList<>();
        for (Student s : students.findAllById(seen)) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", s.getId());
            row.put("full_name", s.getFullName());
            row.put("phone", s.getPhone());
            row.put("roll_no", s.getRollNo());
            row.put("department", s.getDepartment());
            row.put("year", s.getYearOfStudy());
            row.put("tickets", counts.getOrDefault(s.getId(), 0L));
            rows.add(row);
        }
        return rows;
    }

    private List<Map<String, Object>> ticketRows(ReportWindow w) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Ticket t : tickets.findCreatedBetween(w.start(), w.end())) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ticket_no", t.getTicketNo());
            row.put("student", t.getStudent().getFullName());
            row.put("plan", t.getPlanNameSnapshot());
            row.put("price_paise", t.getPricePaiseSnapshot());
            row.put("status", t.getStatus());
            row.put("payment_status", t.getPaymentStatus());
            row.put("priority", t.getPriority());
            row.put("queued_at", when(t.getQueuedAt()));
            row.put("assigned_at", when(t.getAssignedAt()));
            row.put("completed_at", when(t.getCompletedAt()));
            rows.add(row);
        }
        return rows;
    }

    private List<Map<String, Object>> sessionRows(ReportWindow w) {
        List<PlaySession> found = sessions.findStartedBetween(w.start(), w.end());
        Map<Long, List<String>> ticketNos = new HashMap<>();
        if (!found.isEmpty()) {
            for (PlaySessionPlayer p : players.findBySessionIds(found.stream().map(PlaySession::getId).toList())) {
                ticketNos.computeIfAbsent(p.getSession().getId(), k -> new ArrayList<>())
                        .add(p.getTicket().getTicketNo());
            }
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        for (PlaySession s : found) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", s.getId());
            row.put("device", s.getDevice().getCode());
            row.put("tickets", String.join(" ", ticketNos.getOrDefault(s.getId(), List.of())));
            row.put("started_at", when(s.getStartedAt()));
            row.put("planned_end_at", when(s.getPlannedEndAt()));
            row.put("ended_at", when(s.getEndedAt()));
            row.put("end_reason", s.getEndReason());
            row.put("extension_minutes", s.getExtensionMinutesTotal());
            row.put("paused_seconds", s.getPausedTotalSeconds());
            row.put("started_by", s.getStartedBy() == null ? "" : s.getStartedBy().getFullName());
            rows.add(row);
        }
        return rows;
    }

    private List<Map<String, Object>> paymentRows(ReportWindow w) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Payment p : payments.findCollectedBetween(w.start(), w.end())) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", p.getId());
            row.put("ticket_no", p.getTicket().getTicketNo());
            row.put("amount_paise", p.getAmountPaise());
            row.put("kind", p.getKind());
            row.put("method", p.getMethod());
            row.put("reference_no", p.getReferenceNo());
            row.put("collected_by", p.getCollectedBy() == null ? "" : p.getCollectedBy().getFullName());
            row.put("collected_at", when(p.getCollectedAt()));
            row.put("note", p.getNote());
            rows.add(row);
        }
        return rows;
    }

    // ── formatting ───────────────────────────────────────────────────────────

    /** RFC 4180: CRLF rows, and anything containing a comma, quote or newline is quoted. */
    public static String toCsv(List<Map<String, Object>> rows) {
        if (rows.isEmpty()) return "";
        List<String> headers = new ArrayList<>(rows.get(0).keySet());
        StringBuilder sb = new StringBuilder(String.join(",", headers));
        for (Map<String, Object> row : rows) {
            sb.append("\r\n");
            for (int i = 0; i < headers.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append(escape(row.get(headers.get(i))));
            }
        }
        return sb.toString();
    }

    private static String escape(Object value) {
        String s = value == null ? "" : String.valueOf(value);
        if (s.indexOf('"') < 0 && s.indexOf(',') < 0 && s.indexOf('\r') < 0 && s.indexOf('\n') < 0) {
            return s;
        }
        return '"' + s.replace("\"", "\"\"") + '"';
    }

    private static String when(Instant at) {
        return at == null ? "" : at.toString();
    }
}

package local.playplex.service;

import local.playplex.api.dto.AdminDtos.PlanDto;
import local.playplex.api.dto.AdminDtos.PlanInput;
import local.playplex.domain.DeviceType;
import local.playplex.domain.Plan;
import local.playplex.domain.Ticket;
import local.playplex.domain.TicketStatus;
import local.playplex.error.ApiException;
import local.playplex.live.LiveEvent;
import local.playplex.live.LiveEventPublisher;
import local.playplex.repo.DeviceTypeRepository;
import local.playplex.repo.PlanRepository;
import local.playplex.repo.TicketRepository;
import local.playplex.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.*;

/**
 * Prices change mid-event — a sponsor covers the 30-minute slot, say. Editing a plan only
 * ever affects future sales, because every ticket carries a price snapshot (ADR-005).
 */
@Service
public class PlanService {

    private final PlanRepository plans;
    private final DeviceTypeRepository types;
    private final TicketRepository tickets;
    private final AuditService audit;
    private final LiveEventPublisher live;
    private final Clock clock;

    public PlanService(PlanRepository plans, DeviceTypeRepository types, TicketRepository tickets,
                       AuditService audit, LiveEventPublisher live, Clock clock) {
        this.plans = plans;
        this.types = types;
        this.tickets = tickets;
        this.audit = audit;
        this.live = live;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<PlanDto> listActive() {
        Map<Long, Integer> sold = soldCounts();
        return plans.findActiveWithTypes().stream().map(p -> toDto(p, sold)).toList();
    }

    @Transactional(readOnly = true)
    public List<PlanDto> listAll() {
        Map<Long, Integer> sold = soldCounts();
        return plans.findAllWithTypes().stream()
                .sorted(Comparator.comparing(Plan::getSortOrder))
                .map(p -> toDto(p, sold))
                .toList();
    }

    @Transactional
    public PlanDto create(PlanInput input, CurrentUser actor) {
        Plan plan = new Plan();
        apply(plan, input, null);
        plan.setSortOrder((short) (plans.count() + 1));
        plan.setCreatedAt(clock.instant());
        plans.save(plan);
        audit.record(actor.id(), "PLAN_CREATED", "plan", plan.getId(), plan.getName(), null,
                Map.of("pricePaise", plan.getPricePaise(),
                        "durationMinutes", (int) plan.getDurationMinutes()));
        live.publish(LiveEvent.Type.SETTINGS_UPDATED, Map.of());
        return toDto(plan, soldCounts());
    }

    @Transactional
    public PlanDto update(Long id, PlanInput input, CurrentUser actor) {
        Plan plan = plans.findById(id).orElseThrow(() -> ApiException.notFound("Plan"));
        Map<String, Object> before = snapshot(plan);
        apply(plan, input, plan.getId());
        plans.save(plan);

        int wasPrice = (int) before.get("pricePaise");
        if (wasPrice != plan.getPricePaise()) {
            // Recorded on its own: "why is this ticket ₹30 when the board says ₹50?"
            audit.record(actor.id(), "PLAN_PRICE_CHANGED", "plan", plan.getId(), plan.getName(),
                    Map.of("pricePaise", wasPrice), Map.of("pricePaise", plan.getPricePaise()));
        }
        Map<String, Object> after = snapshot(plan);
        Map<String, Object> changedBefore = new LinkedHashMap<>();
        Map<String, Object> changedAfter = new LinkedHashMap<>();
        for (String key : after.keySet()) {
            if (key.equals("pricePaise")) continue;
            if (!Objects.equals(before.get(key), after.get(key))) {
                changedBefore.put(key, before.get(key));
                changedAfter.put(key, after.get(key));
            }
        }
        if (!changedAfter.isEmpty()) {
            audit.record(actor.id(), "PLAN_UPDATED", "plan", plan.getId(), plan.getName(),
                    changedBefore, changedAfter);
        }
        live.publish(LiveEvent.Type.SETTINGS_UPDATED, Map.of());
        return toDto(plan, soldCounts());
    }

    @Transactional
    public List<PlanDto> reorder(List<Long> ids) {
        if (ids != null) {
            for (int i = 0; i < ids.size(); i++) {
                Plan plan = plans.findById(ids.get(i)).orElse(null);
                if (plan != null) {
                    plan.setSortOrder((short) (i + 1));
                    plans.save(plan);
                }
            }
        }
        live.publish(LiveEvent.Type.SETTINGS_UPDATED, Map.of());
        return listAll();
    }

    // ── internals ────────────────────────────────────────────────────────────

    private void apply(Plan plan, PlanInput input, Long selfId) {
        Map<String, String> errors = new LinkedHashMap<>();
        String name = input.name() == null ? "" : input.name().trim();
        if (name.length() < 2) errors.put("name", "Give the plan a name.");
        else if (plans.findAll().stream()
                .anyMatch(p -> !p.getId().equals(selfId) && p.getName().equalsIgnoreCase(name))) {
            errors.put("name", "A plan with that name exists.");
        }
        int duration = input.durationMinutes();
        if (duration < 5 || duration > 240) errors.put("durationMinutes", "Duration must be 5-240 minutes.");
        int price = input.pricePaise();
        if (price < 0 || price > 1_000_000) errors.put("pricePaise", "Enter a price.");
        int seats = input.seatsPerTicket() == null ? 1 : input.seatsPerTicket();
        if (seats < 1 || seats > 4) errors.put("seatsPerTicket", "Seats must be 1-4.");
        if (!errors.isEmpty()) throw ApiException.validation(errors.values().iterator().next(), errors);

        plan.setName(name);
        plan.setDurationMinutes((short) duration);
        plan.setPricePaise(price);
        plan.setDescription(input.description() == null ? "" : input.description().trim());
        plan.setSeatsPerTicket((short) seats);
        plan.setActive(!Boolean.FALSE.equals(input.active()));

        Set<DeviceType> chosen = new LinkedHashSet<>();
        if (input.deviceTypeIds() != null) {
            for (Long typeId : input.deviceTypeIds()) {
                types.findById(typeId).ifPresent(chosen::add);
            }
        }
        plan.setDeviceTypes(chosen);
    }

    private Map<String, Object> snapshot(Plan p) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("name", p.getName());
        map.put("durationMinutes", (int) p.getDurationMinutes());
        map.put("pricePaise", p.getPricePaise());
        map.put("description", p.getDescription());
        map.put("seatsPerTicket", (int) p.getSeatsPerTicket());
        map.put("active", p.isActive());
        map.put("deviceTypeIds", typeIds(p));
        return map;
    }

    /**
     * Sold "at today's price": tickets still on the current snapshot. Once the price moves,
     * the older sales stop counting here, which is exactly the question admin is asking.
     */
    private Map<Long, Integer> soldCounts() {
        Map<Long, Integer> counts = new HashMap<>();
        Map<Long, Integer> prices = new HashMap<>();
        for (Plan p : plans.findAll()) prices.put(p.getId(), p.getPricePaise());
        for (Ticket t : tickets.findAll()) {
            if (t.getPlan() == null || t.getStatus() == TicketStatus.CANCELLED) continue;
            Long planId = t.getPlan().getId();
            Integer price = prices.get(planId);
            if (price != null && price == t.getPricePaiseSnapshot()) {
                counts.merge(planId, 1, Integer::sum);
            }
        }
        return counts;
    }

    private static List<Long> typeIds(Plan p) {
        return p.getDeviceTypes().stream().map(DeviceType::getId).sorted().toList();
    }

    static PlanDto toDto(Plan p, Map<Long, Integer> sold) {
        return new PlanDto(p.getId(), p.getName(), p.getDurationMinutes(), p.getPricePaise(),
                p.getDescription(), p.getSortOrder(), p.isActive(), typeIds(p), p.getSeatsPerTicket(),
                sold.getOrDefault(p.getId(), 0));
    }
}

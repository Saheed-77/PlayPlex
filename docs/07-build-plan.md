# 07 — Build Plan

Seven phases. Each ends with something **demonstrable**, not just "the models are done".

Dates are expressed as **T−n days** before event day. Anchor them to your real date and
put the result in your calendar.

> **The rule that decides everything below: build one vertical slice end to end before
> you build anything wide.**
> Phase 1 produces an ugly page that can register a student, assign them to a laptop and
> run a real countdown. That proves the architecture. Everything after is filling in.
> **Industry term: a *walking skeleton*.** The opposite approach — all entities, then
> all repositories, then all services — leaves you with nothing that works until the
> last day, which is exactly when you find out the design was wrong.

---

## Effort summary

| Phase | Focus | Effort (1 dev) | Deadline |
|---|---|---|---|
| 0 | Foundation | 1–2 days | T−21 |
| 1 | **Walking skeleton** ★ | 3–4 days | T−17 |
| 2 | Reception, properly | 2–3 days | T−14 |
| 3 | Volunteer floor board | 3–4 days | T−10 |
| 4 | Admin: devices, plans, staff | 2–3 days | T−7 |
| 5 | Reports & export | 2 days | T−5 |
| 6 | **Dry run & hardening** ★ | 2–3 days | T−3 |
| 7 | Deploy & rehearse | 1 day | T−1 |
| | **Total** | **~16–22 dev-days** | |

Solo at ~4 focused hours a day, that's **5–6 weeks**. Two people splitting
backend/frontend after Phase 1: **3 weeks**. Start Phase 6 on schedule no matter what
is unfinished — **cut scope, never cut the dry run.**

The starred phases are the ones people skip when they're behind. They are the two that
decide whether event day goes well.

---

## Phase 0 — Foundation (T−21)

**Goal:** `docker compose up` gives a running, empty, migrated system.

| # | Task | Done when |
|---|---|---|
| 0.1 | Git repo, `/backend` `/frontend` `/docs`, `.gitignore`, `.env.example` | Cloned on a second machine and it runs |
| 0.1b | Confirm Docker runs on the **actual event laptop** (Docker Desktop on Windows needs WSL2 + BIOS virtualisation) | `docker run hello-world` succeeds on that machine |
| 0.2 | Spring Boot **4.1** + **Java 17** skeleton (web, data-jpa, security, validation, actuator, flyway, mysql-connector-j) | `/actuator/health` returns `UP` |
| 0.3 | `docker-compose.yml` with **MySQL 8.4** + a volume, UTC + `READ-COMMITTED` + `utf8mb4` flags | Data survives `docker compose down && up` |
| 0.4 | `V1__initial_schema.sql` — every table from [03-data-model.md](03-data-model.md), including both generated columns and the `seq_counter` table | Flyway applies cleanly on an empty DB |
| 0.5 | `V2__seed_reference_data.sql` — 4 device types, 13 devices, 5 plans, 1 admin, `seq_counter`, `event_settings` | `SELECT count(*) FROM device` → 13 |
| **0.5b** ★ | **Timezone smoke test** — insert a session row, read it back through JDBC *and* the `mysql` CLI | Both agree. A 5½-hour gap means one of the three UTC settings is missing — [03-data-model.md §3.3](03-data-model.md#33-no-timestamptz--datetime-plus-discipline) |
| 0.6 | JWT auth + `SecurityConfig` + `@PreAuthorize`, BCrypt | Admin logs in; a volunteer token gets 403 on `/api/admin/**` |
| 0.7 | Vite + React + TS + Tailwind + shadcn/ui; login page wired to the API | Login works, cookie is set, redirect by role |
| 0.8 | Global `ProblemDetail` exception handler + `X-Server-Time` filter | A deliberate error returns RFC-7807 JSON, not a stack trace |

**Acceptance:** three roles can log in and land on three different (empty) pages, and
task 0.5b passes.

> **Budget half a day extra for version friction.** Spring Boot 4 needs Jackson 3 and
> JUnit Jupiter 6, and most search results still assume Spring Boot 3 with Jackson 2 and
> JUnit 4. When something doesn't compile, check [06-architecture.md §5](06-architecture.md#5-version-traps)
> before you check Stack Overflow.

---

## Phase 1 — Walking skeleton ★ (T−17)

**Goal:** the core loop works end to end, ugly but real. **The most important phase.**

| # | Task | Done when |
|---|---|---|
| 1.1 | `POST /api/tickets` — upsert student, snapshot price, insert payment, one transaction | A ticket appears with `PPX-0001` and a payment row |
| 1.2 | Ticket numbers via the `seq_counter` table or JPA `@TableGenerator`, zero-padded | 50 concurrent inserts → 50 distinct, gapless numbers |
| 1.3 | `GET /api/queue` with the priority + FIFO ordering | Order matches [02-workflows.md §6.1](02-workflows.md#61-ordering) |
| 1.4 | `GET /api/floor` composite endpoint, with `JOIN FETCH` | One call, and `show-sql` proves it's ~3 queries, not 40 |
| 1.5 | `POST /api/sessions` — all five guards, `FOR UPDATE`, generated-column unique index | Manual double-assign gives one 201 and one 409 |
| 1.6 | `POST /api/sessions/{id}/end` — device → `CLEANING`, tickets → `COMPLETED` | Device returns to `AVAILABLE` after the delay |
| 1.7 | **Concurrency test**: 10 threads, one device, assert 1×201 + 9×409. Run it against Testcontainers `mysql:8.4`, not H2 | Green, repeatably. Temporarily drop `ux_active_session_per_device` and confirm the test *fails* — that proves the index is what's protecting you |
| 1.8 | Frontend: crude register form + crude device grid | Works. Do not style it yet |
| 1.9 | `useServerNow` skew-corrected ticker + `<Countdown>` | Set the OS clock 5 min fast; countdown is still right |
| 1.10 | Manual polling every 5s (SSE comes in Phase 3) | Board updates without a manual refresh |

**Acceptance — demo this to someone:**
> Register a student → they appear in the queue → assign them to `LAP-01` → a real
> countdown runs → end it → the device frees up → assign the next person.
> Refresh mid-session; the countdown is unchanged. Restart the backend mid-session;
> the countdown is unchanged.

If Phase 1 works, the rest of the project is fundamentally low-risk.

---

## Phase 2 — Reception (T−14)

**Goal:** reception can work a real desk at speed.

| # | Task | Done when |
|---|---|---|
| 2.1 | Student lookup by phone, debounced, auto-fill | Repeat registration takes under 15 seconds |
| 2.2 | Register screen per [05-ui-screens.md §R2](05-ui-screens.md#r2--register-student) | Plan cards, preference radios with live estimates, payment toggle |
| 2.3 | Idempotency key infra (header + 24h store) | Double-click creates exactly one ticket |
| 2.4 | Ticket-number success banner + auto-reset to the phone field | 10 registrations in a row, mouse never touched |
| 2.5 | Wait-estimate calculation | Estimate is within ±5 min of reality in the dry run |
| 2.6 | Availability strip with per-type free counts | Numbers match the DB |
| 2.7 | Today's registrations: search, filter, detail drawer | Find a ticket by partial name in under 3 seconds |
| 2.8 | Cancel + refund (writes a negative payment row) | Ledger sums to zero for that ticket |
| 2.9 | Dues tab + `PAYMENT_DUE` flag | Extensions land here (once Phase 3 ships extend) |
| 2.10 | Validation: phone format, required fields, friendly inline errors | No raw 400s reach the user |

**Acceptance:** time yourself doing 10 registrations. **Median under 60 seconds** — if
not, fix this screen before moving on. It's the bottleneck of the whole event.

---

## Phase 3 — Volunteer floor board (T−10)

**Goal:** the room can actually be run from a phone.

| # | Task | Done when |
|---|---|---|
| 3.1 | `SseEmitter` infrastructure + heartbeat + `ApplicationEventPublisher` wiring | `curl -N /api/stream` prints events as you act elsewhere |
| 3.2 | Publish `device.updated`, `session.*`, `queue.updated`, `ticket.flagged` | All eight event types fire correctly |
| 3.3 | `useFloor` hook: initial fetch, SSE patching, refetch on reconnect | Kill the backend, restart it — the board resyncs by itself |
| 3.4 | Connection indicator + action buttons disabled while disconnected | Pull the Wi-Fi; buttons grey out within 5 seconds |
| 3.5 | Polling fallback after 3 failed SSE reconnects | Simulated by blocking `/api/stream`; board still updates |
| 3.6 | Device cards with all six visual states | Matches the colour/icon table in [05-ui-screens.md §1](05-ui-screens.md#colour-semantics) |
| 3.7 | Urgency ordering + device-type tabs | Overdue always first |
| 3.8 | Queue panel with next-up per device, search, skip-reason chips | Skipping records a reason in the audit log |
| 3.9 | Assign sheet — two-tap happy path; multi-seat for PS5 | PS5 session with 2 tickets uses the shorter duration |
| 3.10 | End + Extend dialogs, reason capture, Dues integration | Extension pushes `planned_end_at`, flags the ticket |
| 3.11 | Overdue sweep `@Scheduled` job + `overdue_notified_at` | Alert fires once, not every 15 seconds |
| 3.12 | Alert rail + `aria-live` announcements + optional chime | Overdue is impossible to miss from two metres |
| 3.13 | Device status change (out-of-service, ready) with reasons | Mid-session fault ends the session as `TECH_ISSUE`, bumps priority |
| 3.14 | Mobile layout: tabs, bottom sheets, 44px targets | Usable one-handed on a real phone |

**Acceptance:** two browsers side by side. Assign in one; the other updates within a
second, with no refresh. Kill the network on one; it degrades honestly and recovers by
itself.

---

## Phase 4 — Admin configuration (T−7)

**Goal:** the event can be reconfigured without a developer.

| # | Task | Done when |
|---|---|---|
| 4.1 | Device-type CRUD | Add "VR Headset" and it appears on every board live |
| 4.2 | Device CRUD, code auto-suggest, soft delete | Add `LAP-11` mid-session; 409 when deleting a busy device |
| 4.3 | Plan CRUD + device-type mapping + the price-change warning | Old tickets keep the old price in reports |
| 4.4 | Staff CRUD, deactivate, password reset | A deactivated user's token stops working |
| 4.5 | Settings screen + live `settings.updated` broadcast | Change the warning threshold; boards react without a reload |
| 4.6 | Admin overrides: force-end, priority bump, cancel-anything | Each writes an audit entry with a required reason |
| 4.7 | Audit log screen with filters | Every override from 4.6 is visible and searchable |
| 4.8 | Force password change for the seeded admin | Can't reach the dashboard on the default password |

**Acceptance:** hand the admin screens to someone non-technical. They add a device type,
add two units, create a plan, and change a price — with no help.

---

## Phase 5 — Reports (T−5)

**Goal:** the event can be closed out and reported on.

| # | Task | Done when |
|---|---|---|
| 5.1 | `/reports/summary` — every KPI in [04-api-spec.md §10](04-api-spec.md#10-reports-admin) | Numbers cross-check against raw SQL |
| 5.2 | Revenue report: by method, plan, collector, hour | Cash + UPI + waived = total, exactly |
| 5.3 | **Cash reconciliation block** with opening float | Printable, matches a hand count in the dry run |
| 5.4 | Utilisation report per device and type | Manually verify one device's percentage |
| 5.5 | Queue report: median wait, distribution, no-show rate | Matches the Phase 6 dry-run observations |
| 5.6 | Student report with search and pagination | 500 rows paginate smoothly |
| 5.7 | CSV export for 4 entity types + audit logging of exports | Opens cleanly in Excel, UTF-8 BOM, no mangled names |
| 5.8 | Admin dashboard tiles + 2 Recharts charts | Live-updating from SSE |
| 5.9 | Post-event anonymisation script | Clears phone/roll no, session rows intact |

**Acceptance:** run a simulated day, then reconcile the report against a hand-tallied
cash box. **They must match to the rupee.**

---

## Phase 6 — Dry run & hardening ★ (T−3)

**Do not skip this phase. Cut features instead.**

| # | Task | Done when |
|---|---|---|
| 6.1 | **90-minute live dry run** with 5–6 real people playing students and staff | See the protocol below |
| 6.2 | Fix everything the dry run surfaced | Re-run the broken flows |
| 6.3 | Load-ish test: 200 tickets, 50 sessions seeded | Floor board still renders in under a second |
| 6.4 | Chaos test: kill the API mid-session; kill MySQL; pull the Wi-Fi | Full recovery, zero data loss, honest UI throughout |
| 6.5 | Clock-skew test: set a tablet 10 minutes fast | Countdowns still correct |
| 6.5b | Re-run the timezone smoke test (0.5b) against the **event build**, and check one session's `started_at` in the `mysql` CLI against the wall clock | UTC end to end; no 5½-hour surprise |
| 6.6 | Real-device pass: the actual volunteer phones/tablets, in the actual room, on the actual Wi-Fi | Everything readable and tappable |
| 6.7 | Accessibility pass: contrast, keyboard, reduced motion | No AA contrast failures |
| 6.8 | Backup script + a **tested restore** | Restore from a dump into a clean DB and verify the data |
| 6.9 | Print the paper fallback sheets | In the box, physically, before event day |
| 6.10 | Write the one-page volunteer cheat sheet | A new volunteer is productive in 5 minutes without help |

**Two of these are automated** — the rest need people and the room.

- **6.3** — `backend/.../FloorUnderLoadTest` seeds 200 tickets and ~56 sessions through the
  real services and asserts `GET /api/floor` stays inside a 500 ms tripwire (it measures
  ~22 ms), that the queue is still correctly ordered with 100+ waiting, and that every free
  station is offered a *different* person. That last one is the bug worth having a test
  for: hand every station the head of the queue and two volunteers start the same student
  on two machines, and you would never notice with three people waiting. It puts the room
  back afterwards — it shares a database with the rest of the suite.
- **6.5** — `frontend/src/api/client.test.ts` poses as a device with a wrong clock and
  checks `serverClock` corrects it, survives responses with no `X-Server-Time`, and stands
  aside for the demo's own clock; `lib.test.ts` then checks a session ending in four
  minutes still reads `ENDING_SOON` on a tablet ten minutes fast, rather than `OVERDUE`.
  Uncorrected, one wrong tablet ends every session it touches early, all evening, and the
  board looks entirely normal while it happens.
- **6.8** — `scripts/backup.sh` and `scripts/restore.sh`; the restore has been rehearsed.

The browser half of 6.3 is `frontend/e2e/floor-under-load.spec.ts`, off by default
(`npm run e2e:load`) because it registers 200 people: it paints the board in ~650 ms
against the one-second budget.

### Dry-run protocol

1. Seed with an empty DB and the real plans.
2. Six volunteers: 1 reception, 2 volunteers, 1 admin, 2 rotating as students.
3. **Run 90 minutes at real pace.** Register continuously, deliberately create the
   awkward cases: no-shows, extensions, a device fault mid-session, a refund, a
   simultaneous double-assign, a shift handover, a network drop.
4. **Nobody explains the UI to anyone.** Watch where they hesitate. Hesitation is the
   bug report.
5. Reconcile the cash box against the report at the end.
6. Everything anyone said "wait, how do I…" about goes on the fix list.

---

## Phase 7 — Deploy & rehearse (T−1)

| # | Task |
|---|---|
| 7.1 | Set up the server laptop: static IP, wired Ethernet, **UPS**, sleep and auto-update disabled |
| 7.2 | `mkcert` local CA; install the root cert on every staff device |
| 7.3 | `docker compose --env-file .env.event up -d`; verify `restart: unless-stopped` by rebooting the laptop |
| 7.4 | Create the real staff accounts; distribute credentials |
| 7.5 | Confirm the real plans and prices with the organising committee — **in writing** |
| 7.6 | Import pre-registrations if you ran the cloud pre-reg |
| 7.7 | Bookmark the URL on every staff device; tape the address + QR at the desk |
| 7.8 | Schedule the 30-minute `mysqldump --single-transaction` job |
| 7.9 | 20-minute walkthrough with the actual volunteer team, in the actual room |
| 7.10 | Print: cheat sheets, paper fallback, cash reconciliation sheet |

---

## Scope-cutting order

If you're behind, cut in this order. Everything above the line is the event; everything
below is polish.

| Cut # | Feature | Why it's safe |
|---|---|---|
| 1 | Charts on the admin dashboard | KPI numbers alone are fine |
| 2 | Department / year fields | Nice reporting, zero operational value |
| 3 | Multi-seat PS5 sessions | Run the PS5 as capacity 1 for now |
| 4 | Audit log **screen** | Keep writing the rows; query them in SQL if needed |
| 5 | Utilisation & queue reports | Revenue and student list are what matter at close |
| 6 | Cleaning state | Set `cleaningAutoClearSeconds = 0` |
| 7 | Device-type CRUD UI | Seed types via SQL; keep device CRUD |
| 8 | Priority queue-jumping | FIFO only |
| ── | **── do not cut below this line ──** | |
| — | SSE live updates | Fall back to 5s polling — but *something* must auto-update |
| — | Idempotency keys | Double-charging a student is unacceptable |
| — | Concurrency guards | Double-assignment is the failure that breaks trust in the room |
| — | Price snapshots | Without them the money report is wrong and unfixable |
| — | The three UTC settings | Get these wrong and every countdown in the app is 5½ hours out |
| — | The dry run | Non-negotiable |

---

## Stretch backlog (after the event, or if you're ahead)

| Idea | Value |
|---|---|
| QR code on the ticket slip; volunteer scans to assign | Removes typing at the busiest moment |
| SMS "you're next" via a bulk gateway | Students could wait outside the room |
| Public queue display on a TV in the corridor | Kills the "how long?" question entirely |
| Pre-registration link + time-slot booking | Flattens the opening-hour spike |
| Photo capture at registration | Faster identification when calling names |
| Leaderboard / most-played device stats | Fun content for the event's social media |
| Multi-event support (`event_id` on every table) | Reuse next year without a rebuild |
| PWA + offline queue with sync | Real offline tolerance, meaningfully more work |

### Deferred infrastructure — each waits for a trigger

Ideas that are *right at a bigger scale and wrong at this one*. Each has a condition that
would make it worth doing; until that condition is true, adding it costs event-day
reliability and buys nothing. Revisit after the event.

| Idea | Only worth it once… | Cheaper first step |
|---|---|---|
| **Redis** as a cache / idempotency store / SSE fan-out | there is **more than one API instance**, or a public read-heavy screen (TV display, student app) multiplies the `GET /floor` load | Caffeine in-process cache, and keep idempotency keys in MySQL so they commit in the same transaction as the ticket |
| **PostgreSQL** instead of MySQL | the four workarounds in [ADR-007](06-architecture.md#adr-007--mysql-over-postgresql) start costing real time, or reporting SQL gets heavier | Nothing to do — the exit is about a day, and the Java barely changes |
| **A message broker** (Rabbit, Kafka) for events | work has to survive a process restart or fan out to other systems | `ApplicationEventPublisher` in-process; a DB-backed job table if durability is needed |
| **Horizontal scaling** behind a load balancer | a single laptop can no longer serve the room — it can, comfortably | Vertical: the event laptop is already oversized for 13 stations |

> Why not now: the whole room is 13 stations, under 10 staff sessions and low thousands of
> rows ([01-product-spec.md §6](01-product-spec.md#6-constraints-and-assumptions) — *"this is
> a small system; do not over-engineer for scale"*). Every extra process is one more thing
> that can be down at 4 pm, and the event laptop has to survive on its own with no internet.

---

## Definition of Done (every task)

- [ ] Behaviour matches the spec in `/docs`; if it doesn't, the doc was updated first
- [ ] Server-side validation and role check present (not just UI enforcement)
- [ ] Errors return RFC-7807 with a stable `code` and a user-safe `detail`
- [ ] Unit test for the business rule; integration test for the transaction
- [ ] Loading, empty and error states exist in the UI — not just the happy path
- [ ] Works on a phone at 375px wide
- [ ] No `console.log`, no commented-out code, no secrets in the repo
- [ ] Migration is additive and forward-only (never edit an applied migration)

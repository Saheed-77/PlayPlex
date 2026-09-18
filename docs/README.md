# PlayPlex — Event Management Application

A gaming-room operations app for a college event. Reception registers students and
collects payment, volunteers assign them to free stations and run the timers, and
admin manages devices, pricing, staff and reporting.

This folder is the **single source of truth** for what gets built. Read the docs in
order the first time; after that, jump to the one you need.

---

## Documents

| # | Document | What it answers |
|---|---|---|
| 01 | [Product Spec](01-product-spec.md) | Who uses it, what's in scope, what success looks like, glossary |
| 02 | [Workflows](02-workflows.md) | The operational flows end to end, with state machines |
| 03 | [Data Model](03-data-model.md) | Tables, relationships, enums, constraints, seed data |
| 04 | [API Spec](04-api-spec.md) | REST endpoints, payloads, error codes, live-update events |
| 05 | [UI & Screens](05-ui-screens.md) | Screen-by-screen spec for all three roles |
| 06 | [Architecture](06-architecture.md) | Stack decision, real-time design, deployment (LAN + cloud) |
| 07 | [Build Plan](07-build-plan.md) | Phased milestones, task breakdown, acceptance criteria |
| 08 | [Event-Day Runbook](08-event-day-runbook.md) | Setup checklist, shift handover, failure modes, paper fallback |

---

## The 30-second version

```
RECEPTION                 QUEUE                VOLUNTEER              ADMIN
─────────                 ─────                ─────────              ─────
Register student   ──▶   Ticket sits    ──▶   Assign to a   ──▶   Sees everything
Pick a plan              in a waiting         free device          + manages devices,
Take cash / UPI          list, per            Timer starts         plans, pricing,
Hand over a              device type          automatically        staff, reports
ticket number                                 End / extend
```

Every screen that matters — reception availability strip, volunteer floor board,
admin dashboard — updates **live**, without anyone pressing refresh.

---

## Decisions already locked in

These came from the kickoff Q&A. Changing one means revisiting the docs that depend on it.

| Decision | Choice | Why |
|---|---|---|
| Backend | **Java 17** + Spring Boot 4.1 | Java 17 is Spring Boot 4's baseline, so nothing is lost. Matches the team's Java skills |
| Database | **MySQL 8.4 LTS**, InnoDB, `utf8mb4` | Chosen for familiarity and ops simplicity over SQL features. Three real trade-offs, all handled — see [ADR-007](06-architecture.md#adr-007--mysql-over-postgresql) |
| Frontend | React + Vite + TypeScript + Tailwind + shadcn/ui | Fast to build, genuinely good-looking dashboards out of the box |
| Live updates | Server-Sent Events (SSE) | One-way server→client is all the dashboards need; far simpler than WebSockets |
| Payments | Recorded, not processed — cash/UPI at reception | No gateway, no keys, no PCI surface. The app is the ledger |
| Deployment | Docker Compose, runs identically on a LAN laptop or a cloud VM | LAN during the event (no internet dependency), cloud for pre-reg and reports |
| Devices | Fully data-driven (types + units are DB rows) | Start with 13 stations, add a 2nd PS5 without a code change |

Full reasoning, the alternatives that were rejected, and an honest
[pros-and-cons breakdown of the whole stack](06-architecture.md#6-pros-and-cons-of-this-stack)
are in [06-architecture.md](06-architecture.md#4-architecture-decisions).

> ⚠️ **Two versions are load-bearing.** Spring Boot 3.x went end-of-life on 30 June 2026
> and MySQL 8.0's support ended 30 April 2026 — but both still dominate search results.
> Pin **Spring Boot 4.1** and **MySQL 8.4**, and check the date on every tutorial you
> follow. The specific things that will bite are listed in
> [06-architecture.md §5](06-architecture.md#5-version-traps).

---

## Starting inventory

| Device type | Code prefix | Units | Seats per unit |
|---|---|---|---|
| PlayStation 5 | `PS5` | 1 | 2 (couch co-op / versus) |
| Gaming PC | `PC` | 1 | 1 |
| Racing Simulator | `SIM` | 1 | 1 |
| Laptop | `LAP` | 10 | 1 |
| **Total** | | **13 stations** | **14 concurrent players** |

Nothing about these numbers is hardcoded. Admin adds a device type or a unit from
the UI and every dashboard picks it up on the next live update.

---

## Conventions used in these docs

- **MUST / SHOULD / MAY** carry their usual RFC 2119 weight. MUST items are acceptance criteria.
- All timestamps are stored and transmitted in **UTC (ISO-8601)**. Display is in `Asia/Kolkata`.
- Money is stored as **integer paise** (`5000` = ₹50.00). No floating-point currency, ever.
- `PPX-0042` style identifiers are **ticket numbers** — human-readable, printed, spoken aloud.
- Diagrams are Mermaid. They render on GitHub, in VS Code (with the Markdown Preview
  Mermaid extension), and in most Markdown viewers.

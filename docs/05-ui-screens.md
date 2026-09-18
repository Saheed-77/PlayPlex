# 05 — UI & Screens

Screen-by-screen spec. Built with **React + Vite + TypeScript + Tailwind + shadcn/ui**.

---

## 1. Design principles

The room is loud, the lighting is bad, and the volunteers are untrained students on
their phones. Design for that, not for a portfolio screenshot.

| # | Principle | In practice |
|---|---|---|
| P1 | **Glanceable over dense** | Status is readable from two metres. Big numbers, big colour blocks |
| P2 | **Colour + shape, never colour alone** | ~8% of men have some colour vision deficiency. Every state also carries an icon and a text label |
| P3 | **Thumb-sized targets** | Minimum 44×44px. Volunteers use phones one-handed |
| P4 | **Three actions maximum** | The floor board offers Assign, End, Extend — plus Pause on a running card, because hunting through a menu mid-fault is where volunteers fumble. Everything else is behind an overflow menu |
| P5 | **Destructive actions confirm** | End and Cancel need a second tap. Force-end needs a typed reason |
| P6 | **Never block on the network** | Optimistic UI with rollback on failure, plus a visible connection indicator |
| P7 | **Dark mode by default** | It's a gaming room with the lights down. Light theme available |

### Colour semantics

| State | Colour | Icon | Also says |
|---|---|---|---|
| Available | Emerald | ● circle | `FREE` |
| In use — running | Slate/Blue | ▶ play | `12:34` counting down |
| Ending soon (< 5 min) | Amber, gentle pulse | ⏱ timer | `04:12` |
| Overdue | Red, strong | ⚠ alert | `+03:20` counting **up** |
| Paused (fault) | Violet | ⏸ pause | `12:34` held · `paused 01:20 of 05:00` |
| Cleaning | Sky | ✦ sparkle | `CLEANING 0:45` |
| Out of service | Zinc, 60% opacity | ⛔ ban | `OUT OF SERVICE` + reason |

---

## 2. Shared shell

Every screen sits inside the same frame:

```
┌────────────────────────────────────────────────────────────────────┐
│ PLAYPLEX          [●] Live       Meera S · Volunteer     [Menu ▾]  │  ← top bar
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│                          screen content                            │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**The `[●] Live` indicator is not decoration.** It is the single most important
trust signal in the app:

| | |
|---|---|
| 🟢 **Live** | SSE connected. Everything you see is current |
| 🟡 **Reconnecting…** | Disconnected. Last-known state shown, **all action buttons disabled** |
| 🔵 **Polling** | SSE gave up, refreshing every 5s. Actions re-enabled |
| 🔴 **Offline** | Server unreachable. Switch to the paper fallback |

---

## 3. Reception screens

### R1 — Login
Username, password, big Sign in button. Nothing else. Errors are inline, never a modal.

### R2 — Register Student
**The most-used screen in the whole app. Optimise it ruthlessly.**

```
┌─────────────────────────────────── REGISTER ────────────────────────────────────┐
│                                                                                  │
│  Phone number                                                                    │
│  ┌────────────────────────┐                                                      │
│  │ 98765 43210            │  ✓ Found: Aravind Kumar · 21CS045 · 2 previous turns │
│  └────────────────────────┘                                                      │
│                                                                                  │
│  Full name                          Roll number        Dept        Year          │
│  ┌───────────────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────┐           │
│  │ Aravind Kumar         │  │ 21CS045      │  │ CSE        │  │  3   │           │
│  └───────────────────────┘  └──────────────┘  └────────────┘  └──────┘           │
│                                                                                  │
│  Choose a plan                                                                   │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│  │Quick Play │ │ Standard  │ │ Marathon  │ │Sim Sprint │ │Console Duo│           │
│  │  15 min   │ │  30 min   │ │  60 min   │ │  15 min   │ │  30 min   │           │
│  │   ₹30     │ │   ₹50  ✓  │ │   ₹90     │ │   ₹50     │ │   ₹80     │           │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘           │
│                                                                                  │
│  Device preference                                                               │
│  ( ) Any — fastest, ~8 min   ( ) Laptop ~15 min   ( ) PS5 ~22 min                │
│  ( ) Gaming PC ~30 min       (•) Racing Sim ~45 min                              │
│                                                                                  │
│  Payment       ┌──────┐ ┌──────┐ ┌────────┐    UPI reference (optional)          │
│                │ CASH │ │ UPI ✓│ │ WAIVED │    ┌──────────────────┐              │
│                └──────┘ └──────┘ └────────┘    │ T2409140912      │              │
│                                                                                  │
│  Your details are used only to manage your session and are deleted after the      │
│  event.                                                                          │
│                                                                                  │
│                                          Amount due  ₹50                         │
│                                    ┌──────────────────────────────┐              │
│                                    │   REGISTER  &  COLLECT  ₹50  │              │
│                                    └──────────────────────────────┘              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Behaviours that make it fast:**

- Phone field is auto-focused on load and after every submit. Reception never touches
  the mouse to start the next registration.
- Lookup debounces at 400 ms; a hit fills every other field and shows the visit count.
- Plans render as **cards, not a dropdown** — one tap, no scrolling, price visible.
- Preference radios carry a **live wait estimate**, which is what actually steers
  students to under-used devices. *"PS5 is 22 minutes but a laptop is 8"* sells itself.
- Submit is disabled while in flight and shows a spinner. The idempotency key is
  generated when the form mounts and regenerated after success — a double-click can
  never double-charge.
- On success: a **full-width green banner with the ticket number in 48px type**, held
  for 4 seconds, then the form clears back to the phone field.

```
┌──────────────────────────────────────────────────────────────┐
│  ✓  Registered                                               │
│                                                              │
│      PPX-0042        Aravind Kumar · Standard · 30 min       │
│                      Position 9 in queue · about 15 minutes  │
└──────────────────────────────────────────────────────────────┘
```

Say the number out loud, write it on the slip, hand it over.

### R3 — Availability Strip
A persistent bar above the register form. Answers the question every student asks
before they've finished walking up.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🎮 PS5      0/1 free   ~22 min  │  🖥 PC     1/1 free   NOW                  │
│  🏎 SIM      0/1 free   ~45 min  │  💻 Laptop  3/10 free  ~8 min   (1 down)   │
│                                                    Queue: 12 waiting          │
└──────────────────────────────────────────────────────────────────────────────┘
```

Updates live via SSE. Read-only for reception.

### R4 — Today's Registrations
Table: ticket no · student · plan · status pill · payment pill · queued at · wait ·
actions. Search across name, phone, ticket number. Filter by status. Row click opens a
detail drawer with the full payment ledger.

Actions per row: **Edit preference** (queued only) · **Cancel + refund** (queued only)
· **Collect due** (when `PAYMENT_DUE`).

### R5 — Dues Tab
Only tickets flagged `PAYMENT_DUE` (from extensions) or `REFUND_DUE` (from tech
issues). Shows a count badge in the nav. **The tab must be empty before close.** This
one screen is the difference between reconciling at close and arguing at close.

---

## 4. Volunteer screens

### V1 — Floor Board
**The main screen. A volunteer should be able to work an entire shift here.**

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ PLAYPLEX     [●] Live                          Meera S · Volunteer      [Menu ▾] │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ⚠  LAP-02 is 3:20 overdue — Rahul                              [ End ]  [ +15 ]  │  ← alert rail
├───────────────────────────┬──────────────────────────────────────────────────────┤
│  QUEUE  (12)              │  ALL   PS5   PC   SIM   LAPTOP                        │
│  ┌─────────────────────┐  │                                                       │
│  │ 1  PPX-0050         │  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │    Nithya           │  │  │ ⚠ LAP-02     │ │ ▶ LAP-01     │ │ ● LAP-05     │  │
│  │    Quick Play 15m   │  │  │              │ │              │ │              │  │
│  │    💻 Laptop · 14m  │  │  │   + 03:20    │ │   12:34      │ │    FREE      │  │
│  ├─────────────────────┤  │  │              │ │              │ │              │  │
│  │ 2  PPX-0051         │  │  │ Rahul        │ │ Aravind      │ │ Next up:     │  │
│  │    Karthik          │  │  │ OVERDUE      │ │ Standard 30m │ │ Nithya       │  │
│  │    Standard 30m     │  │  │              │ │              │ │ PPX-0050     │  │
│  │    Any · 11m        │  │  │ [End] [+15]  │ │ [End] [+15]  │ │ [ ASSIGN ]   │  │
│  ├─────────────────────┤  │  └──────────────┘ └──────────────┘ └──────────────┘  │
│  │ 3  PPX-0052    ⭐   │  │                                                       │
│  │    Divya            │  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │    Sim Sprint 15m   │  │  │ ⏱ PS5-01     │ │ ⛔ LAP-07    │ │ ✦ LAP-03     │  │
│  │    🏎 Sim · 9m      │  │  │              │ │              │ │              │  │
│  └─────────────────────┘  │  │   04:12      │ │  OUT OF      │ │  CLEANING    │  │
│                           │  │              │ │  SERVICE     │ │    0:45      │  │
│  [ Search the queue… ]    │  │ Meena·Sanjay │ │ Charger dead │ │              │  │
│                           │  │ ENDING SOON  │ │              │ │  [ READY ]   │  │
│                           │  │ [End] [+15]  │ │  [ Fixed ]   │ │              │  │
│                           │  └──────────────┘ └──────────────┘ └──────────────┘  │
└───────────────────────────┴──────────────────────────────────────────────────────┘
```

**Layout rules**

- **Ordering is by urgency, not by device code.** Overdue first, then paused (a held station
  is idle while people wait), then ending-soon, then free, then running, then cleaning, then
  out-of-service. A volunteer scanning
  top-left-to-bottom-right always hits what needs attention first.
- The **alert rail** across the top holds every overdue session with inline End/+15, and every
  paused one with inline Resume and the time left before it restarts by itself.
  Hidden entirely when there's nothing wrong — no permanent empty box.
- Device-type tabs filter the grid. Sticky, so a laptop-zone volunteer stays filtered.
- Countdown text is **tabular-nums** so digits don't jitter as they change.
- ⭐ marks a priority ticket in the queue list.

**Countdown implementation:** one `setInterval(…, 1000)` in a single React context that
publishes a corrected `now`. Every card reads it. **Not one interval per card** — 13
intervals fighting for the main thread is how you get a stuttering board on a cheap
tablet.

```ts
// one ticker for the whole app
const now = useServerNow();                       // Date.now() + skewOffset
const remainingMs = +new Date(plannedEndAt) - now;
const isOverdue = remainingMs < 0;
const isEndingSoon = !isOverdue && remainingMs < warningThresholdMs;
```

### V2 — Assign Sheet
Opens as a bottom sheet on mobile, a dialog on desktop.

```
┌───────────────────────────────────────────────┐
│  Assign  LAP-05                          [✕]  │
├───────────────────────────────────────────────┤
│  NEXT UP                                      │
│  ┌─────────────────────────────────────────┐  │
│  │ PPX-0050   Nithya                    ✓  │  │
│  │ Quick Play · 15 min · waiting 14 min    │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  [ Search for someone else…            🔍 ]   │
│                                               │
│  Session will run until  09:27  (15 min)      │
│                                               │
│         ┌───────────────────────────────┐     │
│         │      START  SESSION           │     │
│         └───────────────────────────────┘     │
└───────────────────────────────────────────────┘
```

- Next-up is preselected. **The happy path is two taps: Assign → Start.**
- Searching and picking someone else reveals a required reason chip row:
  `Not present` · `Wants a different device` · `Other`.
- For `capacity > 1` (PS5) the sheet shows two seat slots and the note
  *"Session ends when the shorter plan ends (15 min)."*
- On `409 DEVICE_NOT_AVAILABLE`: sheet closes, toast reads *"LAP-05 was just taken by
  Arun — try LAP-09"*, and the board refreshes. Never a raw error dialog.

### V3 — End, Extend & Pause

**End** — confirm dialog with the reason preselected as `COMPLETED`. Other reasons in a
select; `TECH_ISSUE` and `ADMIN_OVERRIDE` require a note before the button enables.

**Extend** — `+15` / `+30` buttons, then:

```
┌───────────────────────────────────────────────┐
│  Extend LAP-01 by 15 minutes                  │
│  New end time:  09:40                         │
│                                               │
│  ( ) Already paid                             │
│  (•) Collect ₹30 at reception                 │
│      ↳ flags PPX-0042 on reception's Dues tab │
│                                               │
│              [ Cancel ]  [ Extend ]           │
└───────────────────────────────────────────────┘
```

**Extend first, collect later — never interrupt play to chase cash.** The Dues tab is
what makes that safe.

**Pause** — one tap opens a reason chip row (`Game crashed` · `Controller / peripheral` ·
`Power cut` · `Network down` · `Other` + note). The card turns violet, the countdown freezes at
the time still owed, and the pause counts up against a 5-minute budget:

```
┌───────────────────────────────────────────────┐
│  ⏸ PC-01                                      │
│                                               │
│            12:34                              │
│            PAUSED                             │
│   held · paused 01:20 of 05:00                │
│                                               │
│  Kabir · Marathon                             │
│  [    RESUME    ]            [ End ]          │
└───────────────────────────────────────────────┘
```

**Resume is a single tap, with no dialog** — the queue is waiting on it. At the budget the timer
restarts by itself and says so. **Add lost time** in the overflow menu covers the glitch that was
over before anyone reached the tablet, and spends the same budget.

### V4 — My Shift
Sessions this volunteer started, count for the shift, and the **End shift** handover
summary from [02-workflows.md §9](02-workflows.md#9-workflow-shift-handover). Light
gamification (a session count) is genuinely motivating for student volunteers.

---

## 5. Admin screens

### A1 — Dashboard
Live KPI tiles + the floor board underneath.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│  │  REVENUE   │ │ REGISTERED │ │  IN PLAY   │ │  WAITING   │ │ UTILISATION│  │
│  │            │ │            │ │            │ │            │ │            │  │
│  │  ₹9,120    │ │    187     │ │   8 / 13   │ │     12     │ │   78.4%    │  │
│  │  ▲ vs 4pm  │ │  ▲ 23/hr   │ │  1 down    │ │  ~18 min   │ │  ▲ 6 pts   │  │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘  │
│                                                                              │
│  Sessions per hour                            Revenue by device type         │
│  ▁▂▄▆█▇▅▃▂                                    SIM ████████ ₹2,050            │
│  10 11 12 1  2  3  4  5  6                    PS5 ██████   ₹1,840            │
│                                               LAP ████████████ ₹4,230        │
│                                               PC  ███ ₹1,000                 │
├──────────────────────────────────────────────────────────────────────────────┤
│  ⚠  2 tickets have dues outstanding      ⚠  LAP-07 out of service for 41 min │
└──────────────────────────────────────────────────────────────────────────────┘
```

Charts with **Recharts**. Keep it to two — a dashboard nobody reads is worse than no
dashboard. The alert strip at the bottom is the part that actually gets acted on.

### A2 — Devices
Table grouped by device type: code · label · capacity · status · current session ·
uptime today · sessions today · actions.

`+ Add device` — pick a type, and the code auto-suggests the next in sequence
(`LAP-11`). `+ Add device type` for a whole new category (VR, board games, arcade
cabinet). **Adding a second PS5 mid-event is a 10-second job with no deploy** — this is
what "scalable" means in practice for this project.

### A3 — Plans & Pricing
Card grid, drag to reorder, toggle active. Editing a price shows a warning:

> ⚠ Changing this price affects **new** registrations only. The 43 tickets already sold
> at ₹50 keep that price in all reports.

That sentence is the UI making the price-snapshot rule visible, so nobody panics that
the report "changed".

### A4 — Staff
Users table with role badges. Create, deactivate, reset password (shows a one-time
temporary password to read out loud). Never a delete button.

### A5 — Reports
Tabs: **Summary · Revenue · Utilisation · Queue · Students**. Date range picker
defaulting to today. Every tab has **Export CSV**.

The Summary tab is designed to be printed and stapled to the event file — one page,
every headline number, and the cash reconciliation block:

```
CASH RECONCILIATION
  Opening float          ₹  2,000
  Cash collected         ₹  6,050
  Cash refunded          ₹   -150
  ─────────────────────────────────
  Expected in box        ₹  7,900
  Counted                ₹  ______     ← handwritten at close
  Difference             ₹  ______
```

### A6 — Settings
The `event_settings` row as a form: warning threshold, cleaning delay, extensions on/off
and cap, opening float, event name. Changes take effect immediately via
`settings.updated` — no restart.

### A7 — Audit Log
Filterable table: when · who · action · entity · before → after. Read-only, no delete.
Mostly ignored — right up until the afternoon somebody needs it, and then it's the most
important screen in the app.

---

## 6. Responsive behaviour

| Breakpoint | Target | Layout |
|---|---|---|
| `< 640px` | Volunteer phone | Single column. Queue and Devices as two tabs. Actions in bottom sheets |
| `640–1024px` | Volunteer tablet | Queue as a collapsible drawer, 2-column device grid |
| `> 1024px` | Reception / admin laptop | Full split view, 3–4 column device grid |

Reception and admin screens are **desktop-first**; volunteer screens are
**mobile-first**. Build them that way rather than making one layout stretch to cover
both — they're different jobs.

---

## 7. Accessibility

Not optional, and mostly free if you start with it.

- All text meets **WCAG AA** contrast (4.5:1 body, 3:1 for large). Check the amber
  on dark especially — it's the one that usually fails.
- Every status conveys meaning through **icon + label + colour**, never colour alone (P2).
- Full keyboard operation on reception screens: `Tab` order follows the form,
  `Enter` submits, `Esc` closes dialogs.
- Countdown regions are `aria-live="off"` — a screen reader announcing every second
  is unusable. Instead, `aria-live="polite"` fires once on each state change:
  *"LAP-01 ending soon"*, *"LAP-02 overdue"*.
- Touch targets ≥ 44×44 px (P3).
- Respect `prefers-reduced-motion`: the overdue pulse becomes a static border.

---

## 8. Frontend structure

```
src/
├─ api/            # typed fetch client, one file per resource, shared error mapping
├─ hooks/
│   ├─ useServerNow.ts    # the single skew-corrected ticker
│   ├─ useFloor.ts        # /api/floor + SSE patching + reconnect refetch
│   └─ useAuth.ts
├─ components/
│   ├─ ui/                # shadcn primitives — do not hand-edit
│   ├─ DeviceCard.tsx
│   ├─ QueueList.tsx
│   ├─ Countdown.tsx
│   └─ ConnectionIndicator.tsx
├─ pages/
│   ├─ reception/  # Register, Registrations, Dues
│   ├─ volunteer/  # FloorBoard, MyShift
│   └─ admin/      # Dashboard, Devices, Plans, Staff, Reports, Settings, Audit
├─ lib/            # money formatting, time formatting, role guards
└─ types/          # generated from the OpenAPI spec — never hand-written
```

**Generate the TypeScript types from the backend's OpenAPI spec** (springdoc-openapi →
`openapi-typescript`). Hand-maintaining two copies of the same contract is how
frontend and backend silently disagree about a field name at 3 pm on event day.

State: **TanStack Query** for server state (caching, refetch-on-reconnect, and optimistic
updates come free), plain React context for auth and the ticker. No Redux — this app
doesn't have enough client state to justify it.

# 01 — Product Spec

## 1. The problem

A college gaming room with a handful of high-demand stations attracts far more
students than it has seats. Run on paper, three things go wrong within the first hour:

1. **Nobody knows what's free.** Reception keeps sending students in; volunteers have
   no idea which laptop just opened up.
2. **Timers slip.** A 30-minute slot quietly becomes 50 minutes because the volunteer
   who started it went for lunch and the sticky note fell off.
3. **The money doesn't reconcile.** At close, the cash box and the register disagree
   and nobody can reconstruct why.

PlayPlex fixes all three by making the room's state a single shared, live record.

## 2. Goals

| # | Goal | How we'll know it worked |
|---|---|---|
| G1 | A station is never idle while someone is waiting | Median idle-gap between sessions on a device < 2 minutes |
| G2 | No session runs long without someone knowing | Every overdue session is visibly flagged within 15 seconds of expiry |
| G3 | Registration takes under 60 seconds | Reception can register + take payment in one screen, no page reloads |
| G4 | Cash reconciles at close | Admin's revenue report matches the cash box to the rupee |
| G5 | A volunteer can be trained in 5 minutes | The floor board has exactly three actions: Assign, End, Extend |

## 3. Non-goals (explicitly out of scope)

Writing these down is what keeps the build finishable before the event.

- ❌ **Online payment gateway.** Money changes hands at the desk; the app records it.
- ❌ **Student-facing app or self-service kiosk.** Staff-operated only.
- ❌ **Tournament brackets, scores, leaderboards.** Different product.
- ❌ **Game library / title tracking.** We track stations, not what's being played.
- ❌ **Hardware integration.** No auto-locking PCs, no controller detection. A volunteer
  ending a session in the app is the source of truth.
- ❌ **Multi-event / multi-venue tenancy.** One event, one room. (The schema doesn't
  block adding it later, but nothing is built for it now.)
- ❌ **Email/SMS notifications.** Volunteers call names out loud. Adding SMS later is a
  contained change — see [07-build-plan.md](07-build-plan.md#stretch-backlog-after-the-event-or-if-youre-ahead).

## 4. Users and roles

Three roles, strictly nested in capability: `VOLUNTEER ⊂ RECEPTION ⊂ ADMIN`.

### 4.1 Reception (`RECEPTION`)

Sits at the door with a laptop and a cash box. Usually 1–2 people.

**Can:** register students, pick a plan, record cash/UPI payment, issue ticket numbers,
search and edit today's registrations, cancel an unassigned ticket, view live device
availability and queue length (read-only).

**Cannot:** assign devices, start or end sessions, change prices, see revenue totals.

**Their key question:** *"How long is the wait for a laptop right now?"*

### 4.2 Volunteer (`VOLUNTEER`)

Inside the room, on a tablet or phone. 2–4 people across the floor.

**Can:** see the floor board (queue + all devices live), assign a queued ticket to a free
device, end a session, extend a session, mark a device as needing cleaning or
out-of-service, mark a ticket as a no-show.

**Cannot:** register students, take payments, see prices or revenue, change any
configuration.

**Their key question:** *"Which device just freed up, and who's next for it?"*

### 4.3 Admin (`ADMIN`)

Event lead, on a laptop. 1–2 people.

**Can:** everything above, plus — manage device types and devices, manage plans and
pricing, manage staff accounts, adjust event settings, view all reports, export CSV,
read the audit log, and override anything (end any session, force-assign, refund).

**Their key question:** *"Are we making money, is the room busy, and who did that?"*

### 4.4 Permission matrix

| Capability | Volunteer | Reception | Admin |
|---|:---:|:---:|:---:|
| View floor board (devices + queue) | ✅ | ✅ (read-only) | ✅ |
| Register student, issue ticket | ❌ | ✅ | ✅ |
| Record payment / refund | ❌ | ✅ / ❌ | ✅ / ✅ |
| Assign device, start session | ✅ | ❌ | ✅ |
| End / extend session | ✅ | ❌ | ✅ |
| Change device status | ✅ | ❌ | ✅ |
| Manage devices & device types | ❌ | ❌ | ✅ |
| Manage plans & pricing | ❌ | ❌ | ✅ |
| Manage staff accounts | ❌ | ❌ | ✅ |
| View reports & revenue | ❌ | ❌ | ✅ |
| View audit log | ❌ | ❌ | ✅ |
| Override / force actions | ❌ | ❌ | ✅ |

> **Industry term:** this is **RBAC** — *role-based access control*. Every endpoint is
> annotated with the minimum role it requires, and the UI hides what the role can't do.
> The UI hiding a button is a courtesy; the **server check is the actual security**.
> Never rely on the frontend to enforce a permission.

## 5. Core scenarios

These are the flows the build must nail. Full step-by-step versions are in
[02-workflows.md](02-workflows.md).

| ID | Scenario | Frequency |
|---|---|---|
| S1 | Student registers, pays, gets a ticket, joins the queue | ~every 90 seconds at peak |
| S2 | Volunteer assigns the next-in-queue to a device that just freed up | ~every 90 seconds at peak |
| S3 | Session hits its planned end; volunteer ends it and the device returns to the pool | continuous |
| S4 | Student wants 15 more minutes; volunteer extends, reception takes the extra cash | occasional |
| S5 | Called student isn't in the room; volunteer marks no-show and takes the next one | several times an hour |
| S6 | A laptop's charger dies; volunteer marks it out-of-service, queue re-flows | a few times a day |
| S7 | Admin adds a second PS5 mid-event | rare, but MUST work without a deploy |
| S8 | Shift changes; new volunteers log in and see identical state | 2–3 times a day |
| S9 | Admin closes out the day and reconciles cash against the report | once a day |

## 6. Constraints and assumptions

| | |
|---|---|
| **Devices in play** | Reception laptop (1), volunteer tablets/phones (2–4), admin laptop (1) |
| **Network** | College Wi-Fi, assumed flaky. The app MUST keep working when the internet drops — see the LAN deployment in [06-architecture.md](06-architecture.md#9-deployment) |
| **Concurrency** | Under 10 staff sessions. This is a *small* system; do not over-engineer for scale |
| **Data volume** | Hundreds of students, low thousands of sessions. Everything fits comfortably in one MySQL instance |
| **Peak load** | Bursts around class breaks. Queue depth matters more than throughput |
| **Staffing** | Volunteers are students, untrained, rotating. The UI must be obvious without a manual |
| **Data retention** | Student contact details are kept for the event and deleted afterwards — see §8 |

## 7. Success metrics (measured from the app's own data)

- **Station utilization %** — minutes in an active session ÷ minutes the device was
  available. Target > 75% during peak hours.
- **Median wait time** — `assigned_at − queued_at`. Target < 15 minutes.
- **Overdue rate** — sessions ended more than 5 minutes past `planned_end_at`.
  Target < 10%.
- **No-show rate** — tickets marked no-show ÷ tickets queued.
- **Revenue vs. cash box** — must be exact.

All of these fall straight out of the schema in [03-data-model.md](03-data-model.md);
none require extra instrumentation.

## 8. Privacy and data handling

Students hand over a name and phone number. Treat that seriously.

- Collect the **minimum**: name, phone, roll number. Nothing else is required.
- The registration form MUST carry a one-line notice: *"Your details are used only to
  manage your session at this event and are deleted afterwards."*
- Only Reception and Admin can see phone numbers. **Volunteers see first name +
  ticket number only** — they have no reason to see contact details.
- Exports are admin-only and are logged in the audit log.
- After the event, admin runs a purge that clears `student.phone` and
  `student.roll_no` while keeping anonymised session rows for the report.
- Passwords are hashed with **BCrypt**. Never logged, never returned by any endpoint.

## 9. Glossary

Fixed vocabulary — used identically in the code, the DB, the API and the UI. Picking
these words once and never drifting is what keeps a codebase readable.

| Term | Meaning |
|---|---|
| **Device type** | A category of station: PlayStation 5, Gaming PC, Racing Simulator, Laptop |
| **Device** (station) | One physical unit, e.g. `LAP-04`. Belongs to a device type |
| **Plan** | A purchasable slot: a name, a duration in minutes, and a price |
| **Student** | A person. Registered once; may buy many tickets across the event |
| **Ticket** | One purchase = one turn. Carries a ticket number, a plan snapshot, and a status |
| **Queue** | Tickets in `QUEUED` status, ordered by `queued_at`, filtered by device-type preference |
| **Session** | An actual play period on a device: start time, planned end, actual end |
| **Session player** | Links a ticket to a session. Usually one; a PS5 session can have two |
| **Extension** | Extra minutes bought mid-session; pushes `planned_end_at` forward |
| **Overdue** | A session past `planned_end_at` that nobody has ended yet |
| **Floor board** | The volunteer's main screen: queue on the left, device grid on the right |
| **Price snapshot** | The price copied onto the ticket at sale time, so later price edits don't rewrite history |

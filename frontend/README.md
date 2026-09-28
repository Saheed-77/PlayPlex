# PlayPlex — frontend

React 19 + Vite + TypeScript + Tailwind 4 + Radix/shadcn-style components + TanStack Query.
It implements every screen in [`docs/05-ui-screens.md`](../docs/05-ui-screens.md) for all three
roles, and runs **today** against an in-browser mock backend that enforces the rules in
[`docs/04-api-spec.md`](../docs/04-api-spec.md).

```bash
npm install
npm run dev        # http://localhost:5173 — mock backend, no server needed
npm test           # Vitest: UI logic + the backend rules the mock enforces
npm run build      # typecheck + production build
```

## Demo accounts (mock mode)

All passwords are `demo1234`. The login page lists them.

| Username | Role | Lands on |
|---|---|---|
| `priya` | Reception | Register |
| `meera` | Volunteer | Floor board |
| `admin` | Admin | Dashboard |
| `newbie` | Volunteer | Forced password change |

The seed is a mid-event snapshot: about five hours of history, an overdue laptop, two sessions
ending soon, a cleaning station, `LAP-07` out of service, `PC-01` paused mid-fault, 12 people
waiting, and dues on the Dues tab.

## Demo controls — `?demo=1`

The controls are hidden by default, so a hosted demo doesn't hand every visitor a reset
button. Open the site with **`?demo=1`** (e.g. `http://localhost:5173/?demo=1`) and the
**Demo** button appears in the bottom-left corner. The choice is remembered for that browser
tab, so it survives moving between screens; `?demo=0` turns it off again.

| Control | What it shows |
|---|---|
| Simulate traffic | Students register, volunteers assign/end/extend, the odd laptop fails — all through the real handlers, so live events and audit rows appear |
| Clock speed 1×/10×/60× · Jump | Watch cards go amber → red and the alert rail appear |
| Network: Drop SSE / Polling / Offline | The connection indicator, banner, disabled actions and 5-second polling fallback |
| Reset demo data | Re-seeds everything |
| Sign in as | Switches role without signing out |

Open a second tab and sign in as a different role: the tabs share state and live events
through `localStorage` + `BroadcastChannel`, like two staff devices. Assigning the same
free device in both tabs shows the double-assign conflict toast.

## Switching to the real backend

```bash
VITE_API_MODE=http npm run dev   # proxies /api to http://localhost:8080
```

Nothing else changes: `src/api/client.ts` picks the transport. In `http` mode the demo
server and demo panel aren't loaded.

## Layout

```
src/
├─ api/          typed client (one file per resource), RFC 7807 errors, http + SSE transport
├─ mock/         in-browser backend: seed, route handlers, reports, event bus, clock, simulator
├─ hooks/        useServerNow (single ticker), useLive (SSE → cache, polling fallback),
│                useConnection, useAuth, query keys + mutation helper
├─ lib/          deviceState (derived timer states + urgency sort), money, time, pricing
├─ components/   ui primitives · shell · floor (board, cards, dialogs) · reception · admin
└─ pages/        reception/ · volunteer/ · admin/ · login
```

## End-to-end tests

```bash
docker compose up -d          # from the repo root: db + api + web
npm run e2e
```

One spec, and it is the one worth having: a turn from the desk to the floor, with reception
and a volunteer open in two browser contexts at once. Neither screen is reloaded after the
first load — the desk moves between its tabs by clicking the nav — so every assertion about
what the *other* person just did is a live update that had to cross SSE to get there. A
version of this test that reloaded between steps would pass just as happily with the stream
completely broken.

It makes its own staff the way the event lead does on the morning: admin creates the
account, the server issues a one-time password, and the test changes it on first sign-in.
Re-running resets those accounts rather than failing. If the seeded admin password has been
changed on that stack, pass `E2E_ADMIN_PASSWORD`.

It uses the **installed Chrome** (`channel: 'chrome'`) rather than a downloaded build — the
browser the staff tablets actually run, and no 150MB download on every machine. To use
Playwright's own instead: `npx playwright install chromium` and drop the `channel` line.

Against the dev servers instead of the containers:

```bash
E2E_BASE_URL=http://localhost:5173 npm run e2e
```

## Where the frontend adds to the API spec

These started as additions the mock made so the UI could be complete. **They are all in the
Spring Boot backend now** (Phases B–E), and `docs/` has been updated to match:

- `GET /floor` also returns `settings` (warning threshold, extension rules) and `duesCount`,
  so every role gets them without an admin-only call.
- `POST /tickets/{id}/no-show`, `POST /sessions/end-all`, `GET /sessions/mine`,
  `GET|POST /shift/summary|end`, `GET /admin/devices/suggest-code`, `POST /admin/plans/reorder`.
- `payment_status` includes `REFUND_DUE`.
- `plan.seats_per_ticket` (Console Duo = 2 players on one ticket).
- A tech-issue end puts the ticket back to `QUEUED` with priority 1 **and** `REFUND_DUE`;
  starting the reissued turn clears the refund flag, refunding cancels the turn.
- `extend {collectPayment}`: `false` flags `PAYMENT_DUE` (as specced). The UI's
  "Already paid" option sends `true`.

One thing went the other way. The stream's keep-alive used to be a `:heartbeat` comment,
which `EventSource` never surfaces to JavaScript — so a socket wedged open by a dead proxy
looked exactly like a healthy one and the board kept showing a frozen floor under a green
"Live" light. It is now a named `heartbeat` event, and the client runs a watchdog that
reconnects after two missed beats.

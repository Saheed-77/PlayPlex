# 04 — API Spec

Base URL: `/api` · JSON in, JSON out · UTF-8 · all timestamps ISO-8601 UTC.

---

## 1. Conventions

### Response envelope

Success responses return the resource directly, plus a `serverTime` header on every
response:

```
X-Server-Time: 2026-09-14T09:12:03.412Z
```

The frontend reads this once per response to maintain its clock-skew offset.

### Error format (RFC 7807 *Problem Details* — Spring Boot supports it natively)

```json
{
  "type": "https://playplex.local/errors/device-not-available",
  "title": "Device not available",
  "status": 409,
  "detail": "LAP-04 was assigned to PPX-0038 a moment ago.",
  "code": "DEVICE_NOT_AVAILABLE",
  "instance": "/api/sessions"
}
```

`code` is the stable machine-readable string; the UI maps it to a friendly message.
`detail` is safe to show a user. Never leak a stack trace or a SQL string.

| HTTP | `code` values |
|---|---|
| `400` | `VALIDATION_FAILED` |
| `401` | `NOT_AUTHENTICATED`, `TOKEN_EXPIRED` |
| `403` | `INSUFFICIENT_ROLE` |
| `404` | `NOT_FOUND` |
| `409` | `DEVICE_NOT_AVAILABLE`, `TICKET_NOT_QUEUED`, `INVALID_TRANSITION`, `SESSION_ALREADY_ENDED`, `DUPLICATE_PHONE`, `CAPACITY_EXCEEDED` |
| `422` | `BUSINESS_RULE_VIOLATED` |
| `500` | `INTERNAL_ERROR` (generic; details go to the log, not the response) |

### Idempotency

Every **state-changing POST** accepts an `Idempotency-Key` header (a client-generated
UUID). The server stores the key with its response for 24 hours; a repeat of the same
key returns the original response instead of acting twice.

REQUIRED on: `POST /tickets`, `POST /sessions`, `POST /sessions/{id}/end`,
`POST /sessions/{id}/extend`, `POST /tickets/{id}/payments`.

### Auth

Stateless **JWT** in an `HttpOnly`, `SameSite=Lax` cookie. 12-hour expiry — long enough
that nobody is re-logging-in mid-shift, short enough that a lost tablet isn't a
permanent hole. Role claim in the token; every endpoint annotated with
`@PreAuthorize("hasRole('…')")`.

### Pagination

List endpoints take `?page=0&size=50` and return:

```json
{ "content": [ … ], "page": 0, "size": 50, "totalElements": 217, "totalPages": 5 }
```

---

## 2. Auth

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/auth/login` | — | `{username, password}` → sets cookie, returns user + `serverTime` |
| `POST` | `/auth/logout` | any | Clears the cookie |
| `GET` | `/auth/me` | any | Current user, role, permissions, `serverTime` |
| `POST` | `/auth/change-password` | any | `{currentPassword, newPassword}` |

```jsonc
// POST /api/auth/login → 200
{
  "user": { "id": 3, "username": "meera", "fullName": "Meera S", "role": "VOLUNTEER" },
  "serverTime": "2026-09-14T09:12:03.412Z"
}
```

Rate-limit login to 5 attempts per username per minute.

---

## 3. Floor — the composite read

> **The single most important endpoint.** One call returns everything the volunteer
> board and reception availability strip need. One request instead of five is the
> difference between a board that snaps and a board that flickers.
> **Industry term: a *composite* or *BFF* (backend-for-frontend) endpoint** — shaped for
> a screen, not for a table.

`GET /api/floor` — **role: any**

```jsonc
{
  "serverTime": "2026-09-14T09:12:03.412Z",
  "summary": {
    "totalDevices": 13,
    "available": 4,
    "inUse": 8,
    "cleaning": 0,
    "outOfService": 1,
    "queueLength": 12,
    "estimatedWaitMinutes": 18
  },
  "byDeviceType": [
    { "id": 4, "code": "LAP", "name": "Laptop", "icon": "laptop",
      "total": 10, "available": 3, "inUse": 6, "outOfService": 1,
      "queueLength": 9, "estimatedWaitMinutes": 15 }
  ],
  "devices": [
    {
      "id": 7, "code": "LAP-04", "label": "Laptop bay 4",
      "deviceTypeCode": "LAP", "capacity": 1,
      "status": "IN_USE",
      "session": {
        "id": 88,
        "startedAt": "2026-09-14T08:55:00Z",
        "plannedEndAt": "2026-09-14T09:25:00Z",
        "extensionMinutesTotal": 0,
        "players": [
          { "ticketId": 142, "ticketNo": "PPX-0042",
            "displayName": "Aravind",          // first name only for volunteers
            "planName": "Standard", "seatNo": 1 }
        ]
      },
      "nextUp": null
    },
    {
      "id": 8, "code": "LAP-05", "deviceTypeCode": "LAP", "capacity": 1,
      "status": "AVAILABLE", "session": null,
      "nextUp": { "ticketId": 150, "ticketNo": "PPX-0050",
                  "displayName": "Nithya", "planName": "Quick Play",
                  "waitingMinutes": 14 }
    },
    {
      "id": 12, "code": "LAP-07", "deviceTypeCode": "LAP",
      "status": "OUT_OF_SERVICE", "statusReason": "Charger dead",
      "session": null, "nextUp": null
    }
  ]
}
```

Note what is **absent**: no `remainingSeconds`, no `state: "OVERDUE"`. The client derives
both from `plannedEndAt` and its skew-corrected clock. The server never ships a number
that goes stale the instant it's serialised.

---

## 4. Students & tickets (Reception)

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/students?q=` | RECEPTION, ADMIN | Search by phone, name or roll no |
| `POST` | `/students` | RECEPTION, ADMIN | Create (usually done inline by `POST /tickets`) |
| `GET` | `/students/{id}/tickets` | RECEPTION, ADMIN | This student's visit history |

### `POST /api/tickets` — register + pay in one call

**Role:** RECEPTION, ADMIN · **Idempotency-Key: required**

```jsonc
// Request
{
  "student": {                       // or "studentId": 55 for a returning student
    "fullName": "Aravind Kumar",
    "phone": "9876543210",
    "rollNo": "21CS045",
    "department": "CSE",
    "yearOfStudy": 3
  },
  "planId": 2,
  "preferredDeviceTypeId": 4,        // null = any device (fastest)
  "payment": {
    "method": "UPI",                 // CASH | UPI | WAIVED
    "amountPaise": 5000,
    "referenceNo": "T2409140912",
    "note": null                     // required when method = WAIVED
  },
  "notes": null
}
```

```jsonc
// 201 Created
{
  "id": 142,
  "ticketNo": "PPX-0042",
  "student": { "id": 55, "fullName": "Aravind Kumar", "phone": "9876543210" },
  "plan": { "name": "Standard", "durationMinutes": 30, "pricePaise": 5000 },
  "preferredDeviceType": { "code": "LAP", "name": "Laptop" },
  "status": "QUEUED",
  "paymentStatus": "PAID",
  "queuedAt": "2026-09-14T09:12:03Z",
  "queuePosition": 9,
  "estimatedWaitMinutes": 15,
  "serverTime": "2026-09-14T09:12:03.412Z"
}
```

The whole thing is **one database transaction**: upsert student → insert ticket with
price snapshot → insert payment. If any step fails, nothing is written. A student is
never charged for a ticket that doesn't exist, and a ticket never exists unpaid.

### Other ticket endpoints

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/tickets?status=&date=&q=&page=` | RECEPTION, ADMIN | Today's registrations, searchable |
| `GET` | `/tickets/{id}` | RECEPTION, ADMIN | Full detail incl. payment ledger |
| `PATCH` | `/tickets/{id}` | RECEPTION, ADMIN | Edit `preferredDeviceTypeId`, `notes` — **only while `QUEUED`** |
| `POST` | `/tickets/{id}/cancel` | RECEPTION (pre-assign), ADMIN | `{reason, refund: bool}` |
| `POST` | `/tickets/{id}/payments` | RECEPTION, ADMIN | Settle a `PAYMENT_DUE`, or record a refund |
| `POST` | `/tickets/{id}/requeue` | VOLUNTEER, ADMIN | `NO_SHOW → QUEUED`, keeps original `queuedAt` |
| `POST` | `/tickets/{id}/priority` | ADMIN | `{priority, reason}` — audit-logged |

---

## 5. Queue

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/queue?deviceTypeId=&q=` | any | Ordered queue; omit `deviceTypeId` for the full list |
| `GET` | `/queue/next?deviceId=` | VOLUNTEER, ADMIN | The single next-eligible ticket for that device |

```jsonc
// GET /api/queue?deviceTypeId=4
{
  "serverTime": "2026-09-14T09:12:03.412Z",
  "deviceTypeId": 4,
  "items": [
    { "position": 1, "ticketId": 150, "ticketNo": "PPX-0050",
      "displayName": "Nithya", "planName": "Quick Play", "durationMinutes": 15,
      "preferredDeviceTypeCode": "LAP", "priority": 0,
      "queuedAt": "2026-09-14T08:58:00Z", "waitingMinutes": 14 }
  ]
}
```

Reception and admin get `fullName` and `phone` in place of `displayName`. **Same
endpoint, different DTO by role** — the serialiser decides based on the authenticated
role, so a volunteer physically cannot receive a phone number.

---

## 6. Sessions (Volunteer)

### `POST /api/sessions` — assign a device and start the timer

**Role:** VOLUNTEER, ADMIN · **Idempotency-Key: required**

```jsonc
// Request
{
  "deviceId": 8,
  "ticketIds": [150],          // 1..device.capacity — two entries for a PS5 duo
  "skipReason": null           // required if the chosen ticket is not queue position 1
}
```

```jsonc
// 201 Created
{
  "id": 91,
  "device": { "id": 8, "code": "LAP-05" },
  "startedAt":     "2026-09-14T09:12:10Z",
  "plannedEndAt":  "2026-09-14T09:27:10Z",
  "players": [ { "ticketId": 150, "ticketNo": "PPX-0050",
                 "displayName": "Nithya", "planName": "Quick Play", "seatNo": 1 } ],
  "serverTime":    "2026-09-14T09:12:10.088Z"
}
```

**Server-side guards, in order:**

1. Device exists, `active`, status = `AVAILABLE` → else `409 DEVICE_NOT_AVAILABLE`
2. `ticketIds.length ≤ device.capacity` → else `409 CAPACITY_EXCEEDED`
3. Every ticket is `QUEUED` and `paymentStatus != PAYMENT_DUE` → else `409 TICKET_NOT_QUEUED`
4. Every ticket's `preferredDeviceTypeId` is null or matches → else `422 BUSINESS_RULE_VIOLATED`
5. `planned_end_at = now() + MIN(durationMinutes)` across the players
6. Wrapped in one transaction with `SELECT … FOR UPDATE` on the device row, backstopped
   by the generated-column unique index — see [02-workflows.md §4.2](02-workflows.md#42-concurrency-two-volunteers-one-device)

### `POST /api/sessions/{id}/extend`

**Role:** VOLUNTEER, ADMIN · **Idempotency-Key: required**

```jsonc
{ "minutes": 15, "collectPayment": false }   // false → ticket flagged PAYMENT_DUE
```

Rejects if `minutes > settings.maxExtensionMinutes` or `settings.allowExtensions` is
false. `planned_end_at += minutes`, `extension_minutes_total += minutes`,
`overdue_notified_at` reset to null so the alert can fire again later.

### `POST /api/sessions/{id}/pause` · `/resume` · `/lost-time`

**Role:** VOLUNTEER, ADMIN · **Idempotency-Key: required**

A fault interrupts play for a minute or two. Pausing stops the clock so the student keeps the
time they paid for, on the station they are already sitting at.

```jsonc
// POST /api/sessions/91/pause
{ "reason": "GAME_CRASH", "note": null }   // GAME_CRASH | PERIPHERAL | POWER | NETWORK | OTHER (note required)
```

- Refuses with `409 INVALID_TRANSITION` if it is already paused, `409 SESSION_ALREADY_ENDED`
  if it is over, and `422 BUSINESS_RULE_VIOLATED` if the session is already past
  `planned_end_at` (pause protects time still owed, it is not a source of free minutes) or the
  budget is spent.
- **`/resume`** sets `planned_end_at += now() − paused_at`, adds the same amount to
  `paused_total_seconds`, clears `paused_at`, and resets `overdue_notified_at`.
- **`/lost-time`** `{minutes, reason}` is the after-the-fact version for a glitch that ended
  before anyone reached the tablet. It draws on the **same budget**, so an interruption can't be
  both paused and gifted.

**The budget is what protects the queue.** `settings.max_pause_minutes` (default 5) is the total
per session, and a `@Scheduled` sweep resumes any session that reaches it — a forgotten pause can
never hold a station. Every pause, resume, auto-resume and lost-time grant is audit-logged with a
reason. A fault that outlasts the budget is a `TECH_ISSUE` end, which frees the station and
requeues the player at priority 1.

### `POST /api/sessions/{id}/end`

**Role:** VOLUNTEER, ADMIN · **Idempotency-Key: required**

```jsonc
{ "reason": "COMPLETED", "note": null }
```

Sets `ended_at = now()`, tickets → `COMPLETED`, device → `CLEANING` (or straight to
`AVAILABLE` if `cleaningAutoClearSeconds = 0`), `session_player.active = false`.
`TECH_ISSUE` additionally flags the ticket for refund and sets `priority = 1`.

Ending an already-ended session returns `409 SESSION_ALREADY_ENDED` — but the
idempotency key means an honest double-tap returns the original `200`, not an error.

### Other

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/sessions/active` | any | All running sessions |
| `GET` | `/sessions?date=&deviceId=&page=` | ADMIN | History |
| `POST` | `/sessions/{id}/force-end` | ADMIN | `{note}` required. `end_reason = ADMIN_OVERRIDE` |

---

## 7. Devices

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/devices` | any | List with current status |
| `POST` | `/devices/{id}/status` | VOLUNTEER, ADMIN | `{status, reason}`. `reason` required for `OUT_OF_SERVICE` |
| `POST` | `/devices/{id}/ready` | VOLUNTEER, ADMIN | `CLEANING → AVAILABLE` shortcut |
| `POST` | `/admin/devices` | ADMIN | Create a station |
| `PATCH` | `/admin/devices/{id}` | ADMIN | Edit label, capacity, location |
| `DELETE` | `/admin/devices/{id}` | ADMIN | **Soft delete** (`active = false`). `409` if a session is running |
| `GET` | `/admin/device-types` · `POST` · `PATCH` · `DELETE` | ADMIN | Device-type CRUD |

---

## 8. Plans & pricing (Admin)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/plans` | Active plans (reception's dropdown). Filter with `?deviceTypeId=` |
| `GET` | `/admin/plans` | All plans, including archived |
| `POST` | `/admin/plans` | `{name, durationMinutes, pricePaise, description, deviceTypeIds[]}` |
| `PATCH` | `/admin/plans/{id}` | Edit. **Affects future sales only** — existing tickets hold a price snapshot |
| `DELETE` | `/admin/plans/{id}` | Soft delete |

Every price change writes `PLAN_PRICE_CHANGED` to the audit log with before/after.

---

## 9. Staff & settings (Admin)

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` `PATCH` | `/admin/users` | Staff CRUD. `DELETE` deactivates, never deletes |
| `POST` | `/admin/users/{id}/reset-password` | Returns a one-time temporary password |
| `GET` `PUT` | `/admin/settings` | The `event_settings` row |
| `GET` | `/admin/audit-log?action=&userId=&from=&to=&page=` | Filterable audit trail |

---

## 10. Reports (Admin)

| Method | Path | Returns |
|---|---|---|
| `GET` | `/admin/reports/summary?from=&to=` | Headline KPIs (below) |
| `GET` | `/admin/reports/revenue?from=&to=` | By method, by plan, by collector, hourly |
| `GET` | `/admin/reports/utilization?from=&to=` | Per device and per device type |
| `GET` | `/admin/reports/queue?from=&to=` | Wait-time distribution, no-show rate |
| `GET` | `/admin/reports/students?from=&to=&page=` | Every registration, searchable |
| `GET` | `/admin/reports/export?type=&from=&to=` | **CSV** — `type` ∈ `students`, `tickets`, `sessions`, `payments` |

```jsonc
// GET /api/admin/reports/summary?from=2026-09-14&to=2026-09-14
{
  "registrations": 187,
  "sessionsCompleted": 174,
  "sessionsActive": 8,
  "noShows": 11,
  "cancellations": 3,
  "revenue": { "totalPaise": 912000, "cashPaise": 605000, "upiPaise": 307000,
               "refundsPaise": -15000, "waivedPaise": 0, "outstandingDuesPaise": 3000 },
  "utilizationPct": 78.4,
  "medianWaitMinutes": 13,
  "avgSessionMinutes": 31.2,
  "overdueSessions": 9,
  "peakHour": "2026-09-14T15:00:00Z",
  "byDeviceType": [
    { "code": "SIM", "sessions": 41, "revenuePaise": 205000, "utilizationPct": 94.1 }
  ]
}
```

Every export writes `EXPORT_DOWNLOADED` to the audit log — these files contain phone
numbers.

---

## 11. Live updates — Server-Sent Events

`GET /api/stream` · **role: any** · `Content-Type: text/event-stream`

Spring Boot: return a `SseEmitter` (timeout `0` = no timeout), keep them in a
`CopyOnWriteArrayList`, and publish from the service layer via
`ApplicationEventPublisher`. Send a `:heartbeat` comment every 20 seconds so proxies
don't kill idle connections.

### Event types

| Event | Payload | Who cares |
|---|---|---|
| `device.updated` | `{deviceId, code, status, statusReason}` | Everyone |
| `session.started` | `{sessionId, deviceId, plannedEndAt, players[]}` | Volunteer, Admin |
| `session.extended` | `{sessionId, plannedEndAt, minutesAdded}` | Volunteer, Admin |
| `session.paused` | `{sessionId, deviceId, deviceCode, reason, pausedAt}` | Volunteer, Admin |
| `session.resumed` | `{sessionId, deviceId, deviceCode, plannedEndAt, automatic}` | Volunteer, Admin |
| `session.overdue` | `{sessionId, deviceId, deviceCode, overdueSince}` | Volunteer, Admin |
| `session.ended` | `{sessionId, deviceId, endReason}` | Everyone |
| `queue.updated` | `{queueLength, byDeviceType:[{id, length, estimatedWaitMinutes}]}` | Everyone |
| `ticket.flagged` | `{ticketId, ticketNo, flag}` — `PAYMENT_DUE` \| `REFUND_DUE` | Reception, Admin |
| `settings.updated` | `{}` — clients refetch settings | Everyone |

```
event: session.started
data: {"sessionId":91,"deviceId":8,"plannedEndAt":"2026-09-14T09:27:10Z",
       "players":[{"ticketNo":"PPX-0050","displayName":"Nithya"}]}
```

### Client rules

1. **Events are hints, not state.** They carry enough to patch the local view; on
   anything ambiguous, refetch `GET /api/floor`. Never try to rebuild full state from a
   stream of deltas — a single missed event and every board is silently wrong.
2. `EventSource` reconnects on its own. On the `open` event after a drop, **always
   refetch `/api/floor`** to resync.
3. While disconnected: show an amber banner and **disable every action button**. A
   stale board is fine to look at; acting on one is not.
4. **Polling fallback:** if SSE fails three times in a row, fall back to
   `GET /api/floor` every 5 seconds and say so in the banner. The event runs either way.

---

## 12. Health & ops

| Path | Purpose |
|---|---|
| `GET /actuator/health` | Liveness — DB connectivity included |
| `GET /actuator/info` | Build version, so you know what's actually deployed |
| `GET /api/ping` | Unauthenticated. What the ops dashboard on the admin laptop polls |

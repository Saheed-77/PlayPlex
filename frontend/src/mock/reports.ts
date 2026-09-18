import type { CsvExportType, PaymentMethod } from '@/types/api'
import { toCsv } from '@/lib/csv'
import { localDay } from '@/lib/time'
import type { Db, DbDevice } from './db'
import { MIN, byId, iso, median, percentile, sessionTickets, staffName, ticketDto, typeOf } from './logic'
import { fail, type RouteDef } from './router'

// Report maths from docs/03 §6, run over the in-memory tables.

interface Window {
  start: number
  end: number
}

function rangeOf(now: number, query: URLSearchParams): Window & { from: string; to: string } {
  const today = localDay(now)
  const from = query.get('from') || today
  const to = query.get('to') || today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    fail(400, 'VALIDATION_FAILED', 'Pick a valid date range.')
  }
  const start = Date.parse(`${from}T00:00:00+05:30`)
  const end = Date.parse(`${to}T00:00:00+05:30`) + 24 * 60 * MIN
  return { from, to, start, end: Math.min(end, now) }
}

const inWindow = (w: Window, t: number | null) => t !== null && t >= w.start && t < w.end

function deviceMinutes(db: Db, d: DbDevice, w: Window) {
  // Devices only count as available once the room opened.
  const start = Math.max(w.start, d.createdAt, db.eventStartedAt)
  const end = w.end
  if (end <= start) return { inUse: 0, available: 0, down: 0, paused: 0, sessions: 0 }
  let inUse = 0
  let paused = 0
  let sessions = 0
  for (const s of db.sessions.filter((x) => x.deviceId === d.id)) {
    const a = Math.max(s.startedAt, start)
    const b = Math.min(s.endedAt ?? end, end)
    if (b > a) {
      inUse += b - a
      // A paused station was held but not played: don't credit it as utilisation.
      paused += s.pausedTotalMs + (s.pausedAt === null ? 0 : Math.max(0, Math.min(end, w.end) - Math.max(s.pausedAt, start)))
    }
    if (inWindow(w, s.startedAt)) sessions++
  }
  let down = 0
  let since: number | null = null
  for (const log of db.statusLog.filter((l) => l.deviceId === d.id).sort((x, y) => x.changedAt - y.changedAt)) {
    if (log.toStatus === 'OUT_OF_SERVICE' && since === null) since = Math.max(log.changedAt, start)
    else if (log.toStatus !== 'OUT_OF_SERVICE' && since !== null) {
      down += Math.max(0, Math.min(log.changedAt, end) - since)
      since = null
    }
  }
  if (since !== null) down += Math.max(0, end - since)
  const available = Math.max(0, end - start - down)
  const played = Math.max(0, Math.min(inUse, available) - paused)
  return { inUse: played / MIN, available: available / MIN, down: down / MIN, paused: paused / MIN, sessions }
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)

/** Which device type a ticket's money belongs to: where it played, else where it wanted to play. */
function ticketTypeId(db: Db, ticketId: number): number | null {
  const player = db.players.find((p) => p.ticketId === ticketId)
  const session = player && byId(db.sessions, player.sessionId)
  const device = session && byId(db.devices, session.deviceId)
  return device?.deviceTypeId ?? byId(db.tickets, ticketId)?.preferredDeviceTypeId ?? null
}

function summary(db: Db, now: number, w: Window) {
  const tickets = db.tickets.filter((t) => inWindow(w, t.createdAt))
  const payments = db.payments.filter((p) => inWindow(w, p.collectedAt))
  const sum = (xs: { amountPaise: number }[]) => xs.reduce((n, p) => n + p.amountPaise, 0)
  const positive = (m: PaymentMethod) => sum(payments.filter((p) => p.method === m && p.amountPaise > 0))
  const waits = db.tickets.filter((t) => inWindow(w, t.assignedAt)).map((t) => (t.assignedAt! - t.queuedAt) / MIN)
  const ended = db.sessions.filter((s) => inWindow(w, s.endedAt))
  const started = db.sessions.filter((s) => inWindow(w, s.startedAt))
  const hours = new Map<number, number>()
  for (const s of started) {
    const h = Math.floor(s.startedAt / (60 * MIN)) * 60 * MIN
    hours.set(h, (hours.get(h) ?? 0) + 1)
  }
  const peak = [...hours.entries()].sort((a, b) => b[1] - a[1])[0]
  const devices = db.devices.filter((d) => d.active)
  const totals = devices.map((d) => deviceMinutes(db, d, w))

  return {
    registrations: tickets.length,
    sessionsCompleted: ended.length,
    sessionsActive: db.sessions.filter((s) => s.endedAt === null).length,
    noShows: tickets.filter((t) => t.status === 'NO_SHOW').length,
    cancellations: tickets.filter((t) => t.status === 'CANCELLED').length,
    revenue: {
      totalPaise: sum(payments),
      cashPaise: positive('CASH'),
      upiPaise: positive('UPI'),
      refundsPaise: sum(payments.filter((p) => p.amountPaise < 0)),
      cashRefundsPaise: sum(payments.filter((p) => p.amountPaise < 0 && p.method === 'CASH')),
      waivedPaise: tickets.filter((t) => t.paymentStatus === 'WAIVED').reduce((n, t) => n + t.pricePaise, 0),
      outstandingDuesPaise: db.tickets.filter((t) => t.paymentStatus === 'PAYMENT_DUE').reduce((n, t) => n + t.amountDuePaise, 0),
    },
    openingCashFloatPaise: db.settings.openingCashFloatPaise,
    utilizationPct: pct(
      totals.reduce((n, t) => n + t.inUse, 0),
      totals.reduce((n, t) => n + t.available, 0),
    ),
    medianWaitMinutes: Math.round(median(waits)),
    avgSessionMinutes: ended.length ? Math.round((ended.reduce((n, s) => n + (s.endedAt! - s.startedAt), 0) / ended.length / MIN) * 10) / 10 : 0,
    overdueSessions: db.sessions.filter((s) => inWindow(w, s.startedAt) && (s.endedAt ?? now) - s.plannedEndAt > 5 * MIN).length,
    pausedMinutes: Math.round(totals.reduce((n, t) => n + t.paused, 0)),
    // Same rule as the minutes above: any session overlapping the window that was interrupted.
    pausedSessions: db.sessions.filter((s) => s.startedAt < w.end && (s.endedAt ?? now) > w.start && (s.pausedTotalMs > 0 || s.pausedAt !== null)).length,
    peakHour: peak ? iso(peak[0]) : null,
    registrationsLastHour: db.tickets.filter((t) => t.createdAt > now - 60 * MIN).length,
    byDeviceType: db.deviceTypes.map((type) => {
      const mine = devices.filter((d) => d.deviceTypeId === type.id)
      const m = mine.map((d) => deviceMinutes(db, d, w))
      return {
        code: type.code,
        name: type.name,
        sessions: m.reduce((n, x) => n + x.sessions, 0),
        revenuePaise: sum(payments.filter((p) => ticketTypeId(db, p.ticketId) === type.id)),
        utilizationPct: pct(
          m.reduce((n, x) => n + x.inUse, 0),
          m.reduce((n, x) => n + x.available, 0),
        ),
      }
    }),
  }
}

function revenue(db: Db, w: Window) {
  const payments = db.payments.filter((p) => inWindow(w, p.collectedAt))
  const group = <K,>(key: (p: (typeof payments)[number]) => K) => {
    const m = new Map<K, { amountPaise: number; count: number; tickets: Set<number> }>()
    for (const p of payments) {
      const k = key(p)
      const row = m.get(k) ?? { amountPaise: 0, count: 0, tickets: new Set<number>() }
      row.amountPaise += p.amountPaise
      row.count += 1
      row.tickets.add(p.ticketId)
      m.set(k, row)
    }
    return [...m.entries()]
  }
  const hourly: { hour: string; amountPaise: number; sessions: number; registrations: number }[] = []
  const firstHour = Math.max(w.start, Math.min(db.eventStartedAt, ...db.tickets.map((t) => t.createdAt)))
  for (let h = Math.floor(firstHour / (60 * MIN)) * 60 * MIN; h < w.end; h += 60 * MIN) {
    const inHour = (t: number | null) => t !== null && t >= h && t < h + 60 * MIN
    hourly.push({
      hour: iso(h),
      amountPaise: payments.filter((p) => inHour(p.collectedAt)).reduce((n, p) => n + p.amountPaise, 0),
      sessions: db.sessions.filter((s) => inHour(s.startedAt)).length,
      registrations: db.tickets.filter((t) => inHour(t.createdAt)).length,
    })
  }
  return {
    byMethod: (['CASH', 'UPI', 'WAIVED'] as PaymentMethod[]).map((method) => {
      const rows = payments.filter((p) => p.method === method)
      return { method, amountPaise: rows.reduce((n, p) => n + p.amountPaise, 0), count: rows.length }
    }),
    byPlan: group((p) => byId(db.tickets, p.ticketId)?.planName ?? '?')
      .map(([planName, r]) => ({ planName, amountPaise: r.amountPaise, tickets: r.tickets.size }))
      .sort((a, b) => b.amountPaise - a.amountPaise),
    byCollector: group((p) => staffName(db, p.collectedByUserId))
      .map(([name, r]) => ({ name, amountPaise: r.amountPaise, count: r.count }))
      .sort((a, b) => b.amountPaise - a.amountPaise),
    hourly,
  }
}

function utilization(db: Db, w: Window) {
  const byDevice = db.devices
    .filter((d) => d.active)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((d) => {
      const m = deviceMinutes(db, d, w)
      return {
        code: d.code,
        typeCode: typeOf(db, d).code,
        sessions: m.sessions,
        minutesInUse: Math.round(m.inUse),
        minutesAvailable: Math.round(m.available),
        utilizationPct: pct(m.inUse, m.available),
        downMinutes: Math.round(m.down),
        pausedMinutes: Math.round(m.paused),
      }
    })
  return {
    byDevice,
    byType: db.deviceTypes.map((t) => {
      const rows = byDevice.filter((d) => d.typeCode === t.code)
      return {
        code: t.code,
        name: t.name,
        sessions: rows.reduce((n, r) => n + r.sessions, 0),
        utilizationPct: pct(
          rows.reduce((n, r) => n + r.minutesInUse, 0),
          rows.reduce((n, r) => n + r.minutesAvailable, 0),
        ),
      }
    }),
  }
}

function queue(db: Db, w: Window) {
  const assigned = db.tickets.filter((t) => inWindow(w, t.assignedAt))
  const waits = assigned.map((t) => (t.assignedAt! - t.queuedAt) / MIN)
  const buckets: [string, number, number][] = [
    ['0–5', 0, 5],
    ['5–10', 5, 10],
    ['10–15', 10, 15],
    ['15–20', 15, 20],
    ['20–30', 20, 30],
    ['30+', 30, Infinity],
  ]
  const created = db.tickets.filter((t) => inWindow(w, t.createdAt) && t.status !== 'CANCELLED')
  return {
    medianWaitMinutes: Math.round(median(waits)),
    p90WaitMinutes: Math.round(percentile(waits, 90)),
    noShowRatePct: pct(created.filter((t) => t.status === 'NO_SHOW' || t.noShowCount > 0).length, created.length),
    distribution: buckets.map(([bucket, lo, hi]) => ({ bucket, count: waits.filter((x) => x >= lo && x < hi).length })),
    longestWaits: assigned
      .map((t) => ({ ticketNo: t.ticketNo, name: byId(db.students, t.studentId)!.fullName, waitMinutes: Math.round((t.assignedAt! - t.queuedAt) / MIN), skipped: t.skippedCount }))
      .sort((a, b) => b.waitMinutes - a.waitMinutes)
      .slice(0, 8),
  }
}

function exportRows(db: Db, type: CsvExportType, w: Window): Record<string, unknown>[] {
  const when = (t: number | null) => (t === null ? '' : iso(t))
  switch (type) {
    case 'students':
      return db.students
        .filter((s) => db.tickets.some((t) => t.studentId === s.id && inWindow(w, t.createdAt)))
        .map((s) => ({ id: s.id, full_name: s.fullName, phone: s.phone, roll_no: s.rollNo, department: s.department, year: s.yearOfStudy, tickets: db.tickets.filter((t) => t.studentId === s.id).length }))
    case 'tickets':
      return db.tickets
        .filter((t) => inWindow(w, t.createdAt))
        .map((t) => ({ ticket_no: t.ticketNo, student: byId(db.students, t.studentId)!.fullName, plan: t.planName, price_paise: t.pricePaise, status: t.status, payment_status: t.paymentStatus, priority: t.priority, queued_at: when(t.queuedAt), assigned_at: when(t.assignedAt), completed_at: when(t.completedAt) }))
    case 'sessions':
      return db.sessions
        .filter((s) => inWindow(w, s.startedAt))
        .map((s) => ({ id: s.id, device: byId(db.devices, s.deviceId)!.code, tickets: sessionTickets(db, s.id).map((t) => t.ticketNo).join(' '), started_at: when(s.startedAt), planned_end_at: when(s.plannedEndAt), ended_at: when(s.endedAt), end_reason: s.endReason, extension_minutes: s.extensionMinutesTotal, started_by: staffName(db, s.startedByUserId) }))
    case 'payments':
      return db.payments
        .filter((p) => inWindow(w, p.collectedAt))
        .map((p) => ({ id: p.id, ticket_no: byId(db.tickets, p.ticketId)!.ticketNo, amount_paise: p.amountPaise, kind: p.kind, method: p.method, reference_no: p.referenceNo, collected_by: staffName(db, p.collectedByUserId), collected_at: when(p.collectedAt), note: p.note }))
  }
}

const A = ['ADMIN' as const]

export const reportRoutes: RouteDef[] = [
  { method: 'GET', path: '/admin/reports/summary', roles: A, handler: ({ db, now, query }) => summary(db, now, rangeOf(now, query)) },
  { method: 'GET', path: '/admin/reports/revenue', roles: A, handler: ({ db, now, query }) => revenue(db, rangeOf(now, query)) },
  { method: 'GET', path: '/admin/reports/utilization', roles: A, handler: ({ db, now, query }) => utilization(db, rangeOf(now, query)) },
  { method: 'GET', path: '/admin/reports/queue', roles: A, handler: ({ db, now, query }) => queue(db, rangeOf(now, query)) },
  {
    method: 'GET',
    path: '/admin/reports/students',
    roles: A,
    handler: ({ db, now, query }) => {
      const w = rangeOf(now, query)
      const q = (query.get('q') ?? '').trim().toLowerCase()
      const page = Number(query.get('page') ?? 0)
      const size = 25
      const rows = db.tickets
        .filter((t) => inWindow(w, t.createdAt))
        .filter((t) => {
          if (!q) return true
          const s = byId(db.students, t.studentId)!
          return t.ticketNo.toLowerCase().includes(q) || s.fullName.toLowerCase().includes(q) || s.phone.includes(q) || (s.rollNo ?? '').toLowerCase().includes(q)
        })
        .sort((a, b) => b.createdAt - a.createdAt)
      return {
        content: rows.slice(page * size, page * size + size).map((t) => ticketDto(db, t, now)),
        page,
        size,
        totalElements: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / size)),
      }
    },
  },
  {
    method: 'GET',
    path: '/admin/reports/export',
    roles: A,
    mutates: true,
    handler: (ctx) => {
      const type = ctx.query.get('type') as CsvExportType
      if (!['students', 'tickets', 'sessions', 'payments'].includes(type)) fail(400, 'VALIDATION_FAILED', 'Unknown export type.')
      const w = rangeOf(ctx.now, ctx.query)
      // These files contain phone numbers: every export is audited (docs/04 §10).
      ctx.audit('EXPORT_DOWNLOADED', 'report', null, `${type}.csv`, null, { type, from: w.from, to: w.to })
      return toCsv(exportRows(ctx.db, type, w))
    },
  },
]

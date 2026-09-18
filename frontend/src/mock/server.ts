import type { DeviceStatus, EndReason, LiveEvent, PauseReason, PaymentMethod, Role, SkipReason } from '@/types/api'
import { fail, type Body, type Ctx, type RouteDef } from './router'
import { firstName } from '@/lib/utils'
import { clearDb, loadDb, nextId, saveDb, type Db, type DbDevice, type DbSession, type DbStaff, type DbTicket } from './db'
import { createSeed } from './seed'
import {
  MIN,
  activeDevices,
  activeSessionFor,
  balanceOf,
  buildFloor,
  byId,
  canTake,
  extensionPrice,
  iso,
  nextUpMap,
  queueItems,
  sessionSummary,
  sessionTickets,
  simulateQueue,
  staffName,
  studentDto,
  ticketDetailDto,
  ticketDto,
  typeOf,
} from './logic'
import { reportRoutes } from './reports'

interface CompiledRoute extends RouteDef {
  regex: RegExp
  keys: string[]
}

const routes: CompiledRoute[] = []

export function defineRoutes(defs: RouteDef[]) {
  for (const def of defs) {
    const keys: string[] = []
    const pattern = def.path.replace(/:([a-zA-Z]+)/g, (_, k) => {
      keys.push(k)
      return '([^/]+)'
    })
    routes.push({ ...def, regex: new RegExp(`^${pattern}$`), keys, mutates: def.mutates ?? def.method !== 'GET' })
  }
}

// ── DB cache, shared across tabs through localStorage ───────────────────────
let cache: Db | null = null
window.addEventListener('storage', (e) => {
  if (e.key === 'ppx.mock.db') cache = null
})

function getDb(now: number): Db {
  if (!cache) {
    cache = loadDb()
    if (!cache) {
      cache = createSeed(now)
      saveDb(cache)
    }
  }
  return cache
}

export function resetDb() {
  clearDb()
  cache = null
}

const AUTH_KEY = 'ppx.mock.auth'
const authUserId = () => {
  try {
    return Number(sessionStorage.getItem(AUTH_KEY)) || null
  } catch {
    return null
  }
}
const setAuthUserId = (id: number | null) => {
  try {
    if (id === null) sessionStorage.removeItem(AUTH_KEY)
    else sessionStorage.setItem(AUTH_KEY, String(id))
  } catch {
    /* ignore */
  }
}

// ── Request entry point ─────────────────────────────────────────────────────
export interface MockRequest {
  method: string
  path: string
  query?: URLSearchParams
  body?: unknown
  idempotencyKey?: string
  /** Simulator / background actors act as a specific staff user. */
  asUserId?: number
}

export interface MockResponse {
  data: unknown
  serverTime: string
  events: LiveEvent[]
}

export function handle(req: MockRequest, now: number): MockResponse {
  requestNow = now
  const db = getDb(now)
  const events: LiveEvent[] = []
  let dirty = runJobs(db, now, events)

  const route = routes.find((r) => r.method === req.method && r.regex.test(req.path))
  if (!route) fail(404, 'NOT_FOUND', `No mock route for ${req.method} ${req.path}`)
  const match = route!.regex.exec(req.path)!
  const params = Object.fromEntries(route!.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]))

  const userId = req.asUserId ?? authUserId()
  const user = byId(db.staff, userId)
  if (route!.roles !== 'public') {
    if (!user || !user.active) {
      if (dirty) saveDb(db)
      fail(401, 'NOT_AUTHENTICATED', 'Please sign in.')
    }
    if (Array.isArray(route!.roles) && user!.role !== 'ADMIN' && !route!.roles.includes(user!.role)) {
      fail(403, 'INSUFFICIENT_ROLE', `A ${user!.role.toLowerCase()} account can't do that.`)
    }
  }

  if (route!.idempotent) {
    if (!req.idempotencyKey) fail(400, 'VALIDATION_FAILED', 'Idempotency-Key header is required.')
    const stored = db.idempotency[`${req.method} ${req.path} ${req.idempotencyKey}`]
    // An honest double-tap returns the original response instead of acting twice.
    if (stored) return { data: stored.data, serverTime: iso(now), events }
  }

  const ctx: Ctx = {
    db,
    now,
    user: user ?? (null as unknown as DbStaff),
    body: (req.body ?? {}) as Body,
    query: req.query ?? new URLSearchParams(),
    params,
    emit: (type, data = {}) => events.push({ type, data }),
    audit: (action, entityType, entityId, entityLabel, before = null, after = null) =>
      db.audit.push({ id: nextId(db, 'audit'), actorUserId: user?.id ?? 0, action, entityType, entityId, entityLabel, before, after, occurredAt: now }),
    dirty: () => {
      dirty = true
    },
  }

  try {
    const data = route!.handler(ctx)
    if (route!.idempotent) db.idempotency[`${req.method} ${req.path} ${req.idempotencyKey}`] = { at: now, data }
    if (route!.mutates || dirty) saveDb(db)
    return { data, serverTime: iso(now), events }
  } catch (err) {
    // Transactions: a failed handler must not leave half-written state behind.
    cache = null
    throw err
  }
}

/** One pass of the scheduled jobs, outside any request. */
export function tick(now: number): LiveEvent[] {
  const db = getDb(now)
  const events: LiveEvent[] = []
  if (runJobs(db, now, events)) saveDb(db)
  return events
}

export function userIdByUsername(username: string): number | undefined {
  const db = cache ?? loadDb()
  return db?.staff.find((s) => s.username === username && s.active)?.id
}

/** Background work the real backend does with @Scheduled jobs. */
export function runJobs(db: Db, now: number, events: LiveEvent[]): boolean {
  requestNow = now
  let changed = false
  const clearMs = db.settings.cleaningAutoClearSeconds * 1000
  for (const d of activeDevices(db)) {
    if (d.status === 'CLEANING' && d.statusChangedAt + clearMs <= now) {
      setDeviceStatus(db, d, 'AVAILABLE', null, null, d.statusChangedAt + clearMs)
      events.push({ type: 'device.updated', data: deviceEvent(d) })
      events.push({ type: 'queue.updated', data: queueEvent(db) })
      changed = true
    }
  }
  for (const s of db.sessions) {
    // A forgotten pause must never hold a station: resume it at the budget boundary.
    if (s.endedAt === null && s.pausedAt !== null && pauseBudgetLeft(db, s, now) === 0) {
      const resumeAt = s.pausedAt + Math.max(0, db.settings.maxPauseMinutes * MIN - s.pausedTotalMs)
      const device = byId(db.devices, s.deviceId)!
      resumeSession(s, resumeAt)
      db.audit.push({
        id: nextId(db, 'audit'), actorUserId: 0, action: 'SESSION_AUTO_RESUMED', entityType: 'play_session',
        entityId: s.id, entityLabel: device.code, before: null,
        after: { reason: 'Pause budget spent', maxPauseMinutes: db.settings.maxPauseMinutes }, occurredAt: resumeAt,
      })
      events.push({ type: 'session.resumed', data: { sessionId: s.id, deviceId: device.id, deviceCode: device.code, plannedEndAt: iso(s.plannedEndAt), automatic: true } })
      events.push({ type: 'queue.updated', data: queueEvent(db) })
      changed = true
    }
    if (s.endedAt === null && s.pausedAt === null && s.plannedEndAt < now && s.overdueNotifiedAt === null) {
      // Fire once, not every sweep (docs/07 §3.11).
      s.overdueNotifiedAt = now
      const d = byId(db.devices, s.deviceId)!
      events.push({ type: 'session.overdue', data: { sessionId: s.id, deviceId: d.id, deviceCode: d.code, overdueSince: iso(s.plannedEndAt) } })
      changed = true
    }
  }
  for (const [key, entry] of Object.entries(db.idempotency)) {
    if (now - entry.at > 24 * 60 * MIN) {
      delete db.idempotency[key]
      changed = true
    }
  }
  return changed
}

// ── Domain helpers ──────────────────────────────────────────────────────────
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const optStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : NaN)

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) fail(404, 'NOT_FOUND', `${what} not found.`)
  return value as T
}

function deviceEvent(d: DbDevice) {
  return { deviceId: d.id, code: d.code, status: d.status, statusReason: d.statusReason }
}

// The request's clock, so estimates follow the (possibly sped-up) demo time.
let requestNow = 0

function queueEvent(db: Db) {
  const queued = db.tickets.filter((t) => t.status === 'QUEUED')
  const sim = simulateQueue(db, requestNow)
  return {
    queueLength: queued.length,
    byDeviceType: db.deviceTypes.map((t) => ({
      id: t.id,
      length: queued.filter((q) => q.preferredDeviceTypeId === t.id).length,
      estimatedWaitMinutes: sim.typeWait(t.id),
    })),
  }
}

function setDeviceStatus(db: Db, d: DbDevice, status: DeviceStatus, reason: string | null, byUserId: number | null, at: number) {
  db.statusLog.push({ id: nextId(db, 'statusLog'), deviceId: d.id, fromStatus: d.status, toStatus: status, reason, changedAt: at, byUserId })
  d.status = status
  d.statusReason = status === 'OUT_OF_SERVICE' ? reason : null
  d.statusChangedAt = at
}

function endSession(ctx: Ctx, s: DbSession, reason: EndReason, note: string | null, deviceNext: 'CLEAN' | 'OUT' = 'CLEAN') {
  const { db, now, user } = ctx
  if (s.endedAt !== null) fail(409, 'SESSION_ALREADY_ENDED', 'That session has already ended.')
  s.endedAt = now
  s.endReason = reason
  s.endNote = note
  s.endedByUserId = user.id
  const device = byId(db.devices, s.deviceId)!
  const tickets = sessionTickets(db, s.id)
  for (const p of db.players.filter((p) => p.sessionId === s.id)) p.active = false
  for (const t of tickets) {
    if (reason === 'TECH_ISSUE') {
      // Cut off by a fault: straight back to the front of the queue, and flag a refund
      // in case the student would rather have their money back (docs/02 §7).
      Object.assign(t, { status: 'QUEUED', priority: Math.max(1, t.priority), assignedAt: null })
      if (t.paymentStatus !== 'PAYMENT_DUE' && t.paymentStatus !== 'WAIVED') {
        t.paymentStatus = 'REFUND_DUE'
        t.amountDuePaise = Math.max(0, balanceOf(db, t.id))
      }
      ctx.emit('ticket.flagged', { ticketId: t.id, ticketNo: t.ticketNo, flag: 'REFUND_DUE' })
    } else {
      t.status = 'COMPLETED'
      t.completedAt = now
    }
  }
  if (deviceNext === 'CLEAN') {
    const toStatus = db.settings.cleaningAutoClearSeconds === 0 ? 'AVAILABLE' : 'CLEANING'
    setDeviceStatus(db, device, toStatus, null, user.id, now)
  }
  ctx.emit('session.ended', { sessionId: s.id, deviceId: device.id, endReason: reason })
  ctx.emit('device.updated', deviceEvent(device))
  ctx.emit('queue.updated', queueEvent(db))
  return sessionSummary(db, s, user.role)
}

const PAUSE_REASONS: PauseReason[] = ['GAME_CRASH', 'PERIPHERAL', 'POWER', 'NETWORK', 'OTHER']

/** What's left of this session's pause budget, in ms. */
function pauseBudgetLeft(db: Db, s: DbSession, now: number): number {
  const spent = s.pausedTotalMs + (s.pausedAt === null ? 0 : now - s.pausedAt)
  return Math.max(0, db.settings.maxPauseMinutes * MIN - spent)
}

/**
 * Resume: every paused millisecond comes back as playable time, and not one more.
 * `at` lets the scheduled sweep resume exactly on the budget boundary.
 */
function resumeSession(s: DbSession, at: number): number {
  const pausedMs = Math.max(0, at - (s.pausedAt ?? at))
  s.plannedEndAt += pausedMs
  s.pausedTotalMs += pausedMs
  s.pausedAt = null
  s.pauseReason = null
  // The clock moved, so the overdue alert is allowed to fire again later.
  s.overdueNotifiedAt = null
  return pausedMs
}

function shiftSummary(db: Db, user: DbStaff, now: number) {
  const since = db.shifts[user.id] ?? db.eventStartedAt
  const running = db.sessions.filter((s) => s.endedAt === null)
  const players = (s: DbSession) => sessionTickets(db, s.id).map((t) => firstName(byId(db.students, t.studentId)!.fullName))
  const code = (s: DbSession) => byId(db.devices, s.deviceId)!.code
  return {
    userName: user.fullName,
    sessionsStarted: db.sessions.filter((s) => s.startedByUserId === user.id && s.startedAt >= since).length,
    running: running.filter((s) => s.plannedEndAt >= now).map((s) => ({ deviceCode: code(s), plannedEndAt: iso(s.plannedEndAt), players: players(s) })),
    overdue: running.filter((s) => s.plannedEndAt < now).map((s) => ({ deviceCode: code(s), plannedEndAt: iso(s.plannedEndAt), players: players(s) })),
    outOfService: activeDevices(db)
      .filter((d) => d.status === 'OUT_OF_SERVICE')
      .map((d) => ({ deviceCode: d.code, reason: d.statusReason, since: iso(d.statusChangedAt) })),
    paymentDue: db.tickets
      .filter((t) => t.paymentStatus === 'PAYMENT_DUE')
      .map((t) => ({ ticketNo: t.ticketNo, displayName: firstName(byId(db.students, t.studentId)!.fullName), amountDuePaise: t.amountDuePaise })),
  }
}

function staffDto(s: DbStaff) {
  return {
    id: s.id,
    username: s.username,
    fullName: s.fullName,
    role: s.role,
    active: s.active,
    mustChangePassword: s.mustChangePassword,
    lastLoginAt: s.lastLoginAt === null ? null : iso(s.lastLoginAt),
    createdAt: iso(s.createdAt),
  }
}

function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `ppx-${part()}-${part()}`
}

function planDto(db: Db, p: Db['plans'][number]) {
  return {
    ...p,
    createdAt: undefined,
    ticketsSold: db.tickets.filter((t) => t.planId === p.id && t.pricePaise === p.pricePaise && t.status !== 'CANCELLED').length,
  }
}

function adminDeviceDto(db: Db, d: DbDevice, now: number) {
  const s = d.status === 'IN_USE' ? activeSessionFor(db, d.id) : undefined
  const start = Math.max(db.eventStartedAt, d.createdAt)
  const window = Math.max(1, now - start)
  // Down time from the maintenance log.
  let down = 0
  let downSince: number | null = null
  for (const log of db.statusLog.filter((l) => l.deviceId === d.id).sort((a, b) => a.changedAt - b.changedAt)) {
    if (log.toStatus === 'OUT_OF_SERVICE' && downSince === null) downSince = Math.max(log.changedAt, start)
    if (log.toStatus !== 'OUT_OF_SERVICE' && downSince !== null) {
      down += log.changedAt - downSince
      downSince = null
    }
  }
  if (downSince !== null) down += now - downSince
  return {
    id: d.id,
    code: d.code,
    label: d.label,
    locationNote: d.locationNote,
    deviceTypeId: d.deviceTypeId,
    deviceTypeCode: typeOf(db, d).code,
    capacity: d.capacity,
    status: d.status,
    statusReason: d.statusReason,
    active: d.active,
    currentSession: s ? { ticketNos: sessionTickets(db, s.id).map((t) => t.ticketNo), plannedEndAt: iso(s.plannedEndAt) } : null,
    uptimePctToday: Math.round(((window - down) / window) * 1000) / 10,
    sessionsToday: db.sessions.filter((x) => x.deviceId === d.id).length,
  }
}

const PHONE_RE = /^[6-9]\d{9}$/
const METHODS: PaymentMethod[] = ['CASH', 'UPI', 'WAIVED']
const SKIP_REASONS: SkipReason[] = ['NOT_PRESENT', 'WANTS_DIFFERENT_DEVICE', 'OTHER']

// ── Routes ──────────────────────────────────────────────────────────────────
const V: Role[] = ['VOLUNTEER']
const R: Role[] = ['RECEPTION']
const A: Role[] = ['ADMIN']

defineRoutes([
  // Auth
  {
    method: 'POST',
    path: '/auth/login',
    roles: 'public',
    handler: ({ db, body, now }) => {
      const user = db.staff.find((s) => s.username === str(body.username).toLowerCase())
      if (!user || user.password !== body.password) fail(401, 'NOT_AUTHENTICATED', 'Wrong username or password.')
      if (!user!.active) fail(401, 'NOT_AUTHENTICATED', 'This account has been deactivated. Ask the event lead.')
      user!.lastLoginAt = now
      if (user!.role === 'VOLUNTEER' && !db.shifts[user!.id]) db.shifts[user!.id] = now
      setAuthUserId(user!.id)
      return { user: staffDto(user!), serverTime: iso(now) }
    },
  },
  {
    method: 'POST',
    path: '/auth/logout',
    roles: 'public',
    mutates: false,
    handler: () => {
      setAuthUserId(null)
      return null
    },
  },
  { method: 'GET', path: '/auth/me', roles: 'any', handler: ({ user, now }) => ({ user: staffDto(user), serverTime: iso(now) }) },
  {
    method: 'POST',
    path: '/auth/change-password',
    roles: 'any',
    handler: ({ user, body }) => {
      if (body.currentPassword !== user.password) fail(400, 'VALIDATION_FAILED', 'Current password is wrong.', { currentPassword: 'Current password is wrong.' })
      const next = String(body.newPassword ?? '')
      if (next.length < 8) fail(400, 'VALIDATION_FAILED', 'Use at least 8 characters.', { newPassword: 'Use at least 8 characters.' })
      if (next === user.password) fail(400, 'VALIDATION_FAILED', 'Pick a password you have not used here.', { newPassword: 'Must differ from the current password.' })
      user.password = next
      user.mustChangePassword = false
      return staffDto(user)
    },
  },
  { method: 'GET', path: '/shift/summary', roles: 'any', handler: ({ db, user, now }) => shiftSummary(db, user, now) },
  {
    method: 'POST',
    path: '/shift/end',
    roles: 'any',
    handler: (ctx) => {
      const summary = shiftSummary(ctx.db, ctx.user, ctx.now)
      ctx.audit('SHIFT_ENDED', 'staff_user', ctx.user.id, ctx.user.username, null, { sessionsStarted: summary.sessionsStarted, overdue: summary.overdue.length })
      delete ctx.db.shifts[ctx.user.id]
      return summary
    },
  },

  // Floor & queue
  { method: 'GET', path: '/floor', roles: 'any', handler: ({ db, now, user }) => buildFloor(db, now, user.role) },
  {
    method: 'GET',
    path: '/queue',
    roles: 'any',
    handler: ({ db, now, user, query }) => {
      const typeId = query.get('deviceTypeId') ? Number(query.get('deviceTypeId')) : null
      return { serverTime: iso(now), deviceTypeId: typeId, items: queueItems(db, now, user.role, typeId, query.get('q') ?? '') }
    },
  },

  // Students
  {
    method: 'GET',
    path: '/students',
    roles: R,
    handler: ({ db, query }) => {
      const q = (query.get('q') ?? '').trim().toLowerCase()
      if (q.length < 3) return []
      const digits = q.replace(/\D/g, '')
      return db.students
        .filter((s) => (digits.length >= 3 && s.phone.includes(digits)) || s.fullName.toLowerCase().includes(q) || (s.rollNo ?? '').toLowerCase().includes(q))
        .sort((a, b) => Number(b.phone === digits) - Number(a.phone === digits))
        .slice(0, 8)
        .map((s) => studentDto(db, s))
    },
  },

  // Tickets
  {
    method: 'GET',
    path: '/tickets',
    roles: R,
    handler: ({ db, now, query }) => {
      const q = (query.get('q') ?? '').trim().toLowerCase()
      const status = query.get('status')
      const dues = query.get('dues') === 'true'
      const page = Number(query.get('page') ?? 0)
      const size = Number(query.get('size') ?? 50)
      const rows = db.tickets
        .filter((t) => !status || t.status === status)
        .filter((t) => !dues || t.paymentStatus === 'PAYMENT_DUE' || t.paymentStatus === 'REFUND_DUE')
        .filter((t) => {
          if (!q) return true
          const s = byId(db.students, t.studentId)!
          return t.ticketNo.toLowerCase().includes(q) || s.fullName.toLowerCase().includes(q) || s.phone.includes(q)
        })
        .sort((a, b) => b.queuedAt - a.queuedAt)
      const sim = simulateQueue(db, now)
      return {
        content: rows.slice(page * size, page * size + size).map((t) => ticketDto(db, t, now, sim)),
        page,
        size,
        totalElements: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / size)),
      }
    },
  },
  {
    method: 'GET',
    path: '/tickets/:id',
    roles: R,
    handler: ({ db, now, params }) => ticketDetailDto(db, must(byId(db.tickets, Number(params.id)), 'Ticket'), now),
  },
  {
    method: 'POST',
    path: '/tickets',
    roles: R,
    idempotent: true,
    handler: (ctx) => {
      const { db, now, body, user } = ctx
      const errors: Record<string, string> = {}
      const plan = db.plans.find((p) => p.id === body.planId && p.active)
      if (!plan) errors.planId = 'Choose a plan.'

      // One transaction: upsert student → ticket with price snapshot → payment (docs/04 §4).
      let student = body.studentId ? byId(db.students, Number(body.studentId)) : undefined
      const input = body.student as Body | undefined
      if (!student) {
        const phone = str(input?.phone).replace(/\D/g, '')
        if (!PHONE_RE.test(phone)) errors['student.phone'] = 'Enter a 10-digit mobile number.'
        if (str(input?.fullName).length < 2) errors['student.fullName'] = 'Enter the student’s name.'
        student = db.students.find((s) => s.phone === phone)
      }
      const method = body.payment?.method as PaymentMethod
      if (!METHODS.includes(method)) errors['payment.method'] = 'Choose how they paid.'
      if (method === 'WAIVED' && !optStr(body.payment?.note)) errors['payment.note'] = 'Say why this ticket is free.'
      if (plan && method !== 'WAIVED' && body.payment?.amountPaise !== plan.pricePaise) {
        errors['payment.amountPaise'] = 'The amount must match the plan price.'
      }

      let preferred: number | null = body.preferredDeviceTypeId ?? null
      if (preferred !== null && !db.deviceTypes.some((t) => t.id === preferred && t.active)) errors.preferredDeviceTypeId = 'Unknown device type.'
      if (plan && plan.deviceTypeIds.length > 0) {
        if (preferred === null && plan.deviceTypeIds.length === 1) preferred = plan.deviceTypeIds[0]
        else if (preferred === null || !plan.deviceTypeIds.includes(preferred)) {
          errors.preferredDeviceTypeId = `${plan.name} can only be played on ${plan.deviceTypeIds.map((id) => byId(db.deviceTypes, id)?.name).join(' or ')}.`
        }
      }
      if (Object.keys(errors).length) fail(400, 'VALIDATION_FAILED', Object.values(errors)[0], errors)

      if (input) {
        const fields = {
          fullName: str(input.fullName),
          rollNo: optStr(input.rollNo),
          department: optStr(input.department),
          yearOfStudy: Number.isInteger(input.yearOfStudy) ? input.yearOfStudy : null,
        }
        if (student) Object.assign(student, fields)
        else {
          student = { id: nextId(db, 'students'), phone: str(input.phone).replace(/\D/g, ''), createdAt: now, ...fields }
          db.students.push(student)
        }
      }

      db.ticketSeq += 1
      const t: DbTicket = {
        id: nextId(db, 'tickets'),
        ticketNo: `PPX-${String(db.ticketSeq).padStart(4, '0')}`,
        studentId: student!.id,
        planId: plan!.id,
        planName: plan!.name,
        durationMinutes: plan!.durationMinutes,
        pricePaise: plan!.pricePaise,
        seatsPerTicket: plan!.seatsPerTicket,
        preferredDeviceTypeId: preferred,
        status: 'QUEUED',
        paymentStatus: method === 'WAIVED' ? 'WAIVED' : 'PAID',
        amountDuePaise: 0,
        priority: 0,
        queuedAt: now,
        assignedAt: null,
        completedAt: null,
        cancelledAt: null,
        noShowCount: 0,
        skippedCount: 0,
        registeredByUserId: user.id,
        notes: optStr(body.notes),
        createdAt: now,
      }
      db.tickets.push(t)
      db.payments.push({
        id: nextId(db, 'payments'),
        ticketId: t.id,
        amountPaise: method === 'WAIVED' ? 0 : plan!.pricePaise,
        kind: 'INITIAL',
        method,
        referenceNo: optStr(body.payment?.referenceNo),
        collectedByUserId: user.id,
        collectedAt: now,
        note: optStr(body.payment?.note),
      })
      if (method === 'WAIVED') ctx.audit('TICKET_WAIVED', 'ticket', t.id, t.ticketNo, null, { note: optStr(body.payment?.note) })
      ctx.emit('queue.updated', queueEvent(db))
      return ticketDto(db, t, now)
    },
  },
  {
    method: 'PATCH',
    path: '/tickets/:id',
    roles: R,
    handler: (ctx) => {
      const { db, now, body, params } = ctx
      const t = must(byId(db.tickets, Number(params.id)), 'Ticket')
      if (t.status !== 'QUEUED') fail(409, 'INVALID_TRANSITION', 'Only a waiting ticket can be edited.')
      const before = { preferredDeviceTypeId: t.preferredDeviceTypeId, notes: t.notes }
      if ('preferredDeviceTypeId' in body) {
        const pref = body.preferredDeviceTypeId as number | null
        const plan = byId(db.plans, t.planId)
        if (plan && plan.deviceTypeIds.length && (pref === null || !plan.deviceTypeIds.includes(pref))) {
          fail(422, 'BUSINESS_RULE_VIOLATED', `${t.planName} can't be played on that device. Sell a different plan instead.`)
        }
        t.preferredDeviceTypeId = pref
      }
      if ('notes' in body) t.notes = optStr(body.notes)
      ctx.audit('TICKET_UPDATED', 'ticket', t.id, t.ticketNo, before, { preferredDeviceTypeId: t.preferredDeviceTypeId, notes: t.notes })
      ctx.emit('queue.updated', queueEvent(db))
      return ticketDto(db, t, now)
    },
  },
  {
    method: 'POST',
    path: '/tickets/:id/cancel',
    roles: R,
    handler: (ctx) => {
      const { db, now, body, params, user } = ctx
      const t = must(byId(db.tickets, Number(params.id)), 'Ticket')
      const reason = str(body.reason)
      if (!reason) fail(400, 'VALIDATION_FAILED', 'Give a reason for cancelling.', { reason: 'Required.' })
      const allowed = user.role === 'ADMIN' ? ['QUEUED', 'NO_SHOW', 'ASSIGNED'] : ['QUEUED', 'NO_SHOW']
      if (!allowed.includes(t.status)) fail(409, 'INVALID_TRANSITION', `A ${t.status.toLowerCase()} ticket can't be cancelled here.`)
      if (t.status === 'ASSIGNED') {
        const player = db.players.find((p) => p.ticketId === t.id && p.active)
        const s = player && byId(db.sessions, player.sessionId)
        if (s) endSession(ctx, s, 'ADMIN_OVERRIDE', `Ticket cancelled: ${reason}`)
      }
      const before = { status: t.status, paymentStatus: t.paymentStatus }
      t.status = 'CANCELLED'
      t.cancelledAt = now
      const balance = balanceOf(db, t.id)
      if (body.refund && balance > 0) {
        const original = db.payments.find((p) => p.ticketId === t.id && p.kind === 'INITIAL')
        db.payments.push({
          id: nextId(db, 'payments'),
          ticketId: t.id,
          amountPaise: -balance,
          kind: 'REFUND',
          method: (body.method as PaymentMethod) ?? original?.method ?? 'CASH',
          referenceNo: null,
          collectedByUserId: user.id,
          collectedAt: now,
          note: reason,
        })
        t.paymentStatus = 'REFUNDED'
        t.amountDuePaise = 0
      }
      ctx.audit('TICKET_CANCELLED', 'ticket', t.id, t.ticketNo, before, { status: 'CANCELLED', refund: !!body.refund, reason })
      ctx.emit('queue.updated', queueEvent(db))
      ctx.emit('ticket.flagged', { ticketId: t.id, ticketNo: t.ticketNo, flag: null })
      return ticketDto(db, t, now)
    },
  },
  {
    method: 'POST',
    path: '/tickets/:id/payments',
    roles: R,
    idempotent: true,
    handler: (ctx) => {
      const { db, now, body, params, user } = ctx
      const t = must(byId(db.tickets, Number(params.id)), 'Ticket')
      const method = body.method as PaymentMethod
      const amount = int(body.amountPaise)
      if (method !== 'CASH' && method !== 'UPI') fail(400, 'VALIDATION_FAILED', 'Choose cash or UPI.')
      if (body.kind === 'EXTENSION') {
        if (t.paymentStatus !== 'PAYMENT_DUE') fail(409, 'INVALID_TRANSITION', `${t.ticketNo} has nothing due.`)
        if (amount !== t.amountDuePaise) fail(400, 'VALIDATION_FAILED', 'Collect the exact amount due.')
        db.payments.push({ id: nextId(db, 'payments'), ticketId: t.id, amountPaise: amount, kind: 'EXTENSION', method, referenceNo: optStr(body.referenceNo), collectedByUserId: user.id, collectedAt: now, note: optStr(body.note) })
        t.paymentStatus = 'PAID'
        t.amountDuePaise = 0
        ctx.audit('PAYMENT_COLLECTED', 'ticket', t.id, t.ticketNo, { paymentStatus: 'PAYMENT_DUE' }, { paymentStatus: 'PAID', amountPaise: amount, method })
      } else if (body.kind === 'REFUND') {
        if (t.paymentStatus !== 'REFUND_DUE' && user.role !== 'ADMIN') fail(403, 'INSUFFICIENT_ROLE', 'Only admin can refund a ticket that is not flagged for refund.')
        const balance = balanceOf(db, t.id)
        if (!(amount > 0) || amount > balance) fail(400, 'VALIDATION_FAILED', `Refund must be between ₹1 and ₹${balance / 100}.`)
        if (!optStr(body.note)) fail(400, 'VALIDATION_FAILED', 'Add a note for the refund.', { note: 'Required.' })
        db.payments.push({ id: nextId(db, 'payments'), ticketId: t.id, amountPaise: -amount, kind: 'REFUND', method, referenceNo: optStr(body.referenceNo), collectedByUserId: user.id, collectedAt: now, note: optStr(body.note) })
        t.paymentStatus = 'REFUNDED'
        t.amountDuePaise = 0
        // Taking the money back means giving up the reissued turn.
        if (t.status === 'QUEUED') {
          t.status = 'CANCELLED'
          t.cancelledAt = now
        }
        ctx.audit('REFUND_ISSUED', 'ticket', t.id, t.ticketNo, null, { amountPaise: -amount, method, note: optStr(body.note) })
        ctx.emit('queue.updated', queueEvent(db))
      } else {
        fail(400, 'VALIDATION_FAILED', 'Unknown payment kind.')
      }
      ctx.emit('ticket.flagged', { ticketId: t.id, ticketNo: t.ticketNo, flag: null })
      return ticketDetailDto(db, t, now)
    },
  },
  {
    method: 'POST',
    path: '/tickets/:id/no-show',
    roles: V,
    handler: (ctx) => {
      const { db, now, params } = ctx
      const t = must(byId(db.tickets, Number(params.id)), 'Ticket')
      if (t.status !== 'QUEUED') fail(409, 'TICKET_NOT_QUEUED', `${t.ticketNo} is not waiting any more.`)
      t.status = 'NO_SHOW'
      t.noShowCount += 1
      ctx.audit('TICKET_NO_SHOW', 'ticket', t.id, t.ticketNo, { status: 'QUEUED' }, { status: 'NO_SHOW' })
      ctx.emit('queue.updated', queueEvent(db))
      return ticketDto(db, t, now)
    },
  },
  {
    method: 'POST',
    path: '/tickets/:id/requeue',
    roles: 'any',
    handler: (ctx) => {
      const { db, now, params } = ctx
      const t = must(byId(db.tickets, Number(params.id)), 'Ticket')
      if (t.status !== 'NO_SHOW') fail(409, 'INVALID_TRANSITION', 'Only a no-show can be put back in the queue.')
      // Original queued_at is kept, so they land near the front (docs/02 E2).
      t.status = 'QUEUED'
      ctx.audit('TICKET_REQUEUED', 'ticket', t.id, t.ticketNo, { status: 'NO_SHOW' }, { status: 'QUEUED' })
      ctx.emit('queue.updated', queueEvent(db))
      return ticketDto(db, t, now)
    },
  },
  {
    method: 'POST',
    path: '/tickets/:id/priority',
    roles: A,
    handler: (ctx) => {
      const { db, now, params, body } = ctx
      const t = must(byId(db.tickets, Number(params.id)), 'Ticket')
      const reason = str(body.reason)
      if (!reason) fail(400, 'VALIDATION_FAILED', 'A reason is required. Priority bumps are audited.', { reason: 'Required.' })
      const priority = int(body.priority)
      if (!(priority >= 0 && priority <= 5)) fail(400, 'VALIDATION_FAILED', 'Priority must be 0–5.')
      const before = { priority: t.priority }
      t.priority = priority
      ctx.audit('PRIORITY_BUMPED', 'ticket', t.id, t.ticketNo, before, { priority, reason })
      ctx.emit('queue.updated', queueEvent(db))
      return ticketDto(db, t, now)
    },
  },

  // Sessions
  {
    method: 'POST',
    path: '/sessions',
    roles: V,
    idempotent: true,
    handler: (ctx) => {
      const { db, now, body, user } = ctx
      const device = db.devices.find((d) => d.id === body.deviceId && d.active)
      const ids: number[] = Array.isArray(body.ticketIds) ? body.ticketIds : []
      if (ids.length === 0) fail(400, 'VALIDATION_FAILED', 'Pick at least one ticket.')
      // Guard 1: the device is free. The real backend holds SELECT … FOR UPDATE here.
      if (!device || device.status !== 'AVAILABLE') {
        const s = device && activeSessionFor(db, device.id)
        const who = s ? ` by ${staffName(db, s.startedByUserId).split(' ')[0]}` : ''
        const free = activeDevices(db).find((d) => d.status === 'AVAILABLE' && d.deviceTypeId === device?.deviceTypeId && d.id !== device?.id)
        fail(409, 'DEVICE_NOT_AVAILABLE', `${device?.code ?? 'That device'} was just taken${who}${free ? ` — try ${free.code}` : ''}.`)
      }
      const tickets = ids.map((id) => must(byId(db.tickets, id), 'Ticket'))
      // Guard 2: capacity.
      const seats = tickets.reduce((n, t) => n + t.seatsPerTicket, 0)
      if (seats > device!.capacity) fail(409, 'CAPACITY_EXCEEDED', `${device!.code} has ${device!.capacity} seat${device!.capacity > 1 ? 's' : ''}; that's ${seats} players.`)
      // Guard 3: every ticket is waiting and paid up.
      for (const t of tickets) {
        if (t.status !== 'QUEUED') fail(409, 'TICKET_NOT_QUEUED', `${t.ticketNo} is no longer in the queue.`)
        if (t.paymentStatus === 'PAYMENT_DUE') fail(409, 'TICKET_NOT_QUEUED', `${t.ticketNo} owes money — send them to reception first.`)
      }
      // Guard 4: device-type preference.
      const type = typeOf(db, device!)
      for (const t of tickets) {
        if (!canTake(t, device!)) fail(422, 'BUSINESS_RULE_VIOLATED', `${t.ticketNo} is waiting for a ${byId(db.deviceTypes, t.preferredDeviceTypeId)?.name ?? 'different device'}, not a ${type.name}.`)
      }
      // Skipping next-up needs a reason, and is audited (docs/02 §6.2).
      const head = nextUpMap(db).get(device!.id)
      const skipReason = body.skipReason as SkipReason | null
      if (head && !ids.includes(head.id)) {
        if (!skipReason || !SKIP_REASONS.includes(skipReason)) fail(400, 'VALIDATION_FAILED', `Say why ${head.ticketNo} is being skipped.`, { skipReason: 'Required.' })
        head.skippedCount += 1
        ctx.audit('QUEUE_SKIPPED', 'ticket', head.id, head.ticketNo, null, { reason: skipReason, device: device!.code, instead: tickets.map((t) => t.ticketNo).join(', ') })
      }
      // Guard 5: the session ends when the shortest plan ends.
      const minutes = Math.min(...tickets.map((t) => t.durationMinutes))
      const s: DbSession = {
        id: nextId(db, 'sessions'),
        deviceId: device!.id,
        startedAt: now,
        plannedEndAt: now + minutes * MIN,
        endedAt: null,
        endReason: null,
        endNote: null,
        extensionMinutesTotal: 0,
        pausedAt: null,
        pausedTotalMs: 0,
        pauseReason: null,
        overdueNotifiedAt: null,
        warnedAt: null,
        startedByUserId: user.id,
        endedByUserId: null,
      }
      db.sessions.push(s)
      let seat = 1
      for (const t of tickets) {
        db.players.push({ sessionId: s.id, ticketId: t.id, seatNo: seat, active: true })
        seat += t.seatsPerTicket
        t.status = 'ASSIGNED'
        t.assignedAt = now
        // Playing the reissued turn settles a pending tech-issue refund.
        if (t.paymentStatus === 'REFUND_DUE') {
          t.paymentStatus = 'PAID'
          t.amountDuePaise = 0
        }
      }
      setDeviceStatus(db, device!, 'IN_USE', null, user.id, now)
      const summary = sessionSummary(db, s, user.role)
      ctx.emit('session.started', { sessionId: s.id, deviceId: device!.id, plannedEndAt: iso(s.plannedEndAt), players: summary.ticketNos.map((ticketNo, i) => ({ ticketNo, displayName: firstName(summary.playerNames[i]) })) })
      ctx.emit('device.updated', deviceEvent(device!))
      ctx.emit('queue.updated', queueEvent(db))
      return summary
    },
  },
  {
    method: 'POST',
    path: '/sessions/:id/extend',
    roles: V,
    idempotent: true,
    handler: (ctx) => {
      const { db, body, params, user } = ctx
      const s = must(byId(db.sessions, Number(params.id)), 'Session')
      if (s.endedAt !== null) fail(409, 'SESSION_ALREADY_ENDED', 'That session has already ended.')
      if (!db.settings.allowExtensions) fail(422, 'BUSINESS_RULE_VIOLATED', 'Extensions are switched off for this event.')
      const minutes = int(body.minutes)
      if (!(minutes > 0)) fail(400, 'VALIDATION_FAILED', 'Pick how many minutes to add.')
      if (s.extensionMinutesTotal + minutes > db.settings.maxExtensionMinutes) {
        const left = db.settings.maxExtensionMinutes - s.extensionMinutesTotal
        fail(422, 'BUSINESS_RULE_VIOLATED', left > 0 ? `Only ${left} more minutes can be added to this session.` : 'This session has used all its extension time.')
      }
      s.plannedEndAt += minutes * MIN
      s.extensionMinutesTotal += minutes
      s.overdueNotifiedAt = null
      const device = byId(db.devices, s.deviceId)!
      // collectPayment=false → play first, reception collects later via the Dues tab.
      if (!body.collectPayment) {
        for (const t of sessionTickets(db, s.id)) {
          if (t.paymentStatus === 'WAIVED') continue
          t.paymentStatus = 'PAYMENT_DUE'
          t.amountDuePaise += extensionPrice(db, t, device.deviceTypeId, minutes)
          ctx.emit('ticket.flagged', { ticketId: t.id, ticketNo: t.ticketNo, flag: 'PAYMENT_DUE' })
        }
      }
      ctx.audit('SESSION_EXTENDED', 'play_session', s.id, device.code, null, { minutes, collectAtDesk: !body.collectPayment })
      ctx.emit('session.extended', { sessionId: s.id, plannedEndAt: iso(s.plannedEndAt), minutesAdded: minutes })
      ctx.emit('queue.updated', queueEvent(db))
      return sessionSummary(db, s, user.role)
    },
  },
  {
    method: 'POST',
    path: '/sessions/:id/pause',
    roles: V,
    idempotent: true,
    handler: (ctx) => {
      const { db, now, body, params, user } = ctx
      const s = must(byId(db.sessions, Number(params.id)), 'Session')
      const device = byId(db.devices, s.deviceId)!
      if (s.endedAt !== null) fail(409, 'SESSION_ALREADY_ENDED', 'That session has already ended.')
      if (s.pausedAt !== null) fail(409, 'INVALID_TRANSITION', `${device.code} is already paused.`)
      if (db.settings.maxPauseMinutes <= 0) fail(422, 'BUSINESS_RULE_VIOLATED', 'Pausing is switched off for this event.')
      // Pause protects time still owed to the player; it is not a source of free minutes.
      if (s.plannedEndAt <= now) fail(422, 'BUSINESS_RULE_VIOLATED', `${device.code} is already out of time — end it or add 15 minutes instead.`)
      const left = pauseBudgetLeft(db, s, now)
      if (left <= 0) fail(422, 'BUSINESS_RULE_VIOLATED', `${device.code} has used its ${db.settings.maxPauseMinutes} minutes of pause. End it as a tech issue if the fault continues.`)
      const reason = body.reason as PauseReason
      if (!PAUSE_REASONS.includes(reason)) fail(400, 'VALIDATION_FAILED', 'Pick what went wrong.', { reason: 'Required.' })
      const note = optStr(body.note)
      if (reason === 'OTHER' && !note) fail(400, 'VALIDATION_FAILED', 'Say what happened.', { note: 'Required.' })
      s.pausedAt = now
      s.pauseReason = reason
      ctx.audit('SESSION_PAUSED', 'play_session', s.id, device.code, null, { reason, note, budgetLeftSeconds: Math.round(left / 1000) })
      ctx.emit('session.paused', { sessionId: s.id, deviceId: device.id, deviceCode: device.code, reason, pausedAt: iso(now) })
      ctx.emit('queue.updated', queueEvent(db))
      return sessionSummary(db, s, user.role)
    },
  },
  {
    method: 'POST',
    path: '/sessions/:id/resume',
    roles: V,
    idempotent: true,
    handler: (ctx) => {
      const { db, now, params, user } = ctx
      const s = must(byId(db.sessions, Number(params.id)), 'Session')
      const device = byId(db.devices, s.deviceId)!
      if (s.endedAt !== null) fail(409, 'SESSION_ALREADY_ENDED', 'That session has already ended.')
      if (s.pausedAt === null) fail(409, 'INVALID_TRANSITION', `${device.code} is already running.`)
      const pausedMs = resumeSession(s, now)
      ctx.audit('SESSION_RESUMED', 'play_session', s.id, device.code, null, { pausedSeconds: Math.round(pausedMs / 1000), newEndAt: iso(s.plannedEndAt) })
      ctx.emit('session.resumed', { sessionId: s.id, deviceId: device.id, deviceCode: device.code, plannedEndAt: iso(s.plannedEndAt), automatic: false })
      ctx.emit('queue.updated', queueEvent(db))
      return sessionSummary(db, s, user.role)
    },
  },
  {
    method: 'POST',
    path: '/sessions/:id/lost-time',
    roles: V,
    idempotent: true,
    handler: (ctx) => {
      // For when the glitch was over before anyone reached the tablet. Draws on the same
      // budget as a pause, so play can't be interrupted and gifted twice.
      const { db, now, body, params, user } = ctx
      const s = must(byId(db.sessions, Number(params.id)), 'Session')
      const device = byId(db.devices, s.deviceId)!
      if (s.endedAt !== null) fail(409, 'SESSION_ALREADY_ENDED', 'That session has already ended.')
      if (s.pausedAt !== null) fail(409, 'INVALID_TRANSITION', `${device.code} is paused — resume it instead.`)
      if (db.settings.maxPauseMinutes <= 0) fail(422, 'BUSINESS_RULE_VIOLATED', 'Pausing is switched off for this event.')
      const reason = body.reason as PauseReason
      if (!PAUSE_REASONS.includes(reason)) fail(400, 'VALIDATION_FAILED', 'Pick what went wrong.', { reason: 'Required.' })
      const minutes = int(body.minutes)
      if (!(minutes > 0)) fail(400, 'VALIDATION_FAILED', 'Pick how many minutes were lost.')
      const leftMinutes = Math.floor(pauseBudgetLeft(db, s, now) / MIN)
      if (minutes > leftMinutes) {
        fail(422, 'BUSINESS_RULE_VIOLATED', leftMinutes > 0 ? `Only ${leftMinutes} more minute${leftMinutes === 1 ? '' : 's'} can be given back on this session.` : `${device.code} has used its ${db.settings.maxPauseMinutes} minutes of pause.`)
      }
      s.plannedEndAt += minutes * MIN
      s.pausedTotalMs += minutes * MIN
      s.overdueNotifiedAt = null
      ctx.audit('SESSION_LOST_TIME', 'play_session', s.id, device.code, null, { minutes, reason, note: optStr(body.note) })
      ctx.emit('session.resumed', { sessionId: s.id, deviceId: device.id, deviceCode: device.code, plannedEndAt: iso(s.plannedEndAt), automatic: false })
      ctx.emit('queue.updated', queueEvent(db))
      return sessionSummary(db, s, user.role)
    },
  },
  {
    method: 'POST',
    path: '/sessions/:id/end',
    roles: V,
    idempotent: true,
    handler: (ctx) => {
      const { db, body, params, user } = ctx
      const s = must(byId(db.sessions, Number(params.id)), 'Session')
      const reason = body.reason as EndReason
      if (!['COMPLETED', 'ENDED_EARLY', 'TECH_ISSUE', 'ADMIN_OVERRIDE'].includes(reason)) fail(400, 'VALIDATION_FAILED', 'Pick a reason.')
      if (reason === 'ADMIN_OVERRIDE' && user.role !== 'ADMIN') fail(403, 'INSUFFICIENT_ROLE', 'Only admin can override.')
      const note = optStr(body.note)
      if ((reason === 'TECH_ISSUE' || reason === 'ADMIN_OVERRIDE') && !note) fail(400, 'VALIDATION_FAILED', 'Add a note explaining what happened.', { note: 'Required.' })
      const device = byId(db.devices, s.deviceId)!
      const result = endSession(ctx, s, reason, note)
      if (reason !== 'COMPLETED') ctx.audit('SESSION_ENDED', 'play_session', s.id, device.code, null, { reason, note })
      return result
    },
  },
  {
    method: 'POST',
    path: '/sessions/:id/force-end',
    roles: A,
    handler: (ctx) => {
      const s = must(byId(ctx.db.sessions, Number(ctx.params.id)), 'Session')
      const note = optStr(ctx.body.note)
      if (!note) fail(400, 'VALIDATION_FAILED', 'Type the reason for forcing this session to end.', { note: 'Required.' })
      const device = byId(ctx.db.devices, s.deviceId)!
      const result = endSession(ctx, s, 'ADMIN_OVERRIDE', note)
      ctx.audit('SESSION_FORCE_ENDED', 'play_session', s.id, device.code, null, { note })
      return result
    },
  },
  {
    method: 'POST',
    path: '/sessions/end-all',
    roles: A,
    handler: (ctx) => {
      const note = optStr(ctx.body.note)
      if (!note) fail(400, 'VALIDATION_FAILED', 'Add a note for closing the room.', { note: 'Required.' })
      const running = ctx.db.sessions.filter((s) => s.endedAt === null)
      for (const s of running) endSession(ctx, s, 'COMPLETED', note)
      ctx.audit('SESSIONS_BULK_ENDED', 'play_session', null, `${running.length} sessions`, null, { note })
      return { ended: running.length }
    },
  },
  {
    method: 'GET',
    path: '/sessions/mine',
    roles: 'any',
    handler: ({ db, user }) => {
      const since = db.shifts[user.id] ?? db.eventStartedAt
      return db.sessions
        .filter((s) => s.startedByUserId === user.id && s.startedAt >= since)
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((s) => sessionSummary(db, s, user.role))
    },
  },

  // Devices (floor actions)
  {
    method: 'POST',
    path: '/devices/:id/status',
    roles: V,
    handler: (ctx) => {
      const { db, now, body, params, user } = ctx
      const d = must(db.devices.find((x) => x.id === Number(params.id) && x.active), 'Device')
      const status = body.status as DeviceStatus
      const reason = optStr(body.reason)
      if (!['AVAILABLE', 'CLEANING', 'OUT_OF_SERVICE'].includes(status)) fail(400, 'VALIDATION_FAILED', 'Unknown status.')
      if (status === 'OUT_OF_SERVICE' && !reason) fail(400, 'VALIDATION_FAILED', 'Say what is wrong with it.', { reason: 'Required.' })
      if (d.status === status) return null
      const before = { status: d.status }
      if (d.status === 'IN_USE') {
        if (status !== 'OUT_OF_SERVICE') fail(409, 'INVALID_TRANSITION', `End the session on ${d.code} first.`)
        // A fault mid-session ends it as TECH_ISSUE and bumps the players (docs/02 §7).
        const s = activeSessionFor(db, d.id)
        if (s) endSession(ctx, s, 'TECH_ISSUE', reason, 'OUT')
      }
      setDeviceStatus(db, d, status, reason, user.id, now)
      ctx.audit('DEVICE_STATUS_CHANGED', 'device', d.id, d.code, before, { status, reason })
      ctx.emit('device.updated', deviceEvent(d))
      ctx.emit('queue.updated', queueEvent(db))
      return null
    },
  },
  {
    method: 'POST',
    path: '/devices/:id/ready',
    roles: V,
    handler: (ctx) => {
      const { db, now, params, user } = ctx
      const d = must(db.devices.find((x) => x.id === Number(params.id) && x.active), 'Device')
      if (d.status !== 'CLEANING') fail(409, 'INVALID_TRANSITION', `${d.code} isn't being cleaned.`)
      setDeviceStatus(db, d, 'AVAILABLE', null, user.id, now)
      ctx.emit('device.updated', deviceEvent(d))
      ctx.emit('queue.updated', queueEvent(db))
      return null
    },
  },

  // Admin: devices & device types
  {
    method: 'GET',
    path: '/admin/devices',
    roles: A,
    handler: ({ db, now }) =>
      [...db.devices].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map((d) => adminDeviceDto(db, d, now)),
  },
  {
    method: 'GET',
    path: '/admin/devices/suggest-code',
    roles: A,
    handler: ({ db, query }) => {
      const type = must(byId(db.deviceTypes, Number(query.get('deviceTypeId'))), 'Device type')
      const used = db.devices
        .filter((d) => d.deviceTypeId === type.id)
        .map((d) => Number(d.code.split('-').pop()))
        .filter((n) => !Number.isNaN(n))
      return { code: `${type.code}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}` }
    },
  },
  {
    method: 'POST',
    path: '/admin/devices',
    roles: A,
    handler: (ctx) => {
      const { db, now, body } = ctx
      const type = db.deviceTypes.find((t) => t.id === body.deviceTypeId && t.active)
      const code = str(body.code).toUpperCase()
      const errors: Record<string, string> = {}
      if (!type) errors.deviceTypeId = 'Pick a device type.'
      if (!/^[A-Z0-9]+-\d{2,3}$/.test(code)) errors.code = 'Use the form LAP-11.'
      else if (db.devices.some((d) => d.code === code)) errors.code = `${code} already exists.`
      const capacity = int(body.capacity)
      if (!(capacity >= 1 && capacity <= 8)) errors.capacity = 'Seats must be 1–8.'
      if (Object.keys(errors).length) fail(400, 'VALIDATION_FAILED', Object.values(errors)[0], errors)
      const d: DbDevice = {
        id: nextId(db, 'devices'),
        deviceTypeId: type!.id,
        code,
        label: str(body.label) || `${type!.name} ${code.split('-').pop()}`,
        locationNote: str(body.locationNote),
        capacity,
        status: 'AVAILABLE',
        statusReason: null,
        statusChangedAt: now,
        active: true,
        createdAt: now,
      }
      db.devices.push(d)
      ctx.audit('DEVICE_CREATED', 'device', d.id, d.code, null, { type: type!.code, capacity })
      ctx.emit('device.updated', deviceEvent(d))
      ctx.emit('queue.updated', queueEvent(db))
      return adminDeviceDto(db, d, now)
    },
  },
  {
    method: 'PATCH',
    path: '/admin/devices/:id',
    roles: A,
    handler: (ctx) => {
      const { db, now, body, params } = ctx
      const d = must(byId(db.devices, Number(params.id)), 'Device')
      const before = { label: d.label, locationNote: d.locationNote, capacity: d.capacity, active: d.active }
      if ('label' in body) d.label = str(body.label)
      if ('locationNote' in body) d.locationNote = str(body.locationNote)
      if ('capacity' in body) {
        const capacity = int(body.capacity)
        if (!(capacity >= 1 && capacity <= 8)) fail(400, 'VALIDATION_FAILED', 'Seats must be 1–8.', { capacity: 'Seats must be 1–8.' })
        const s = activeSessionFor(db, d.id)
        if (s && sessionTickets(db, s.id).reduce((n, t) => n + t.seatsPerTicket, 0) > capacity) fail(409, 'INVALID_TRANSITION', 'More players are on it right now than that.')
        d.capacity = capacity
      }
      if (body.active === true && !d.active) {
        d.active = true
        setDeviceStatus(db, d, 'AVAILABLE', null, ctx.user.id, now)
      }
      ctx.audit('DEVICE_UPDATED', 'device', d.id, d.code, before, { label: d.label, locationNote: d.locationNote, capacity: d.capacity, active: d.active })
      ctx.emit('device.updated', deviceEvent(d))
      return adminDeviceDto(db, d, now)
    },
  },
  {
    method: 'DELETE',
    path: '/admin/devices/:id',
    roles: A,
    handler: (ctx) => {
      const d = must(byId(ctx.db.devices, Number(ctx.params.id)), 'Device')
      // Soft delete, and never under a running session (docs/02 E7).
      if (d.status === 'IN_USE') fail(409, 'INVALID_TRANSITION', `${d.code} has a session running. End it first.`)
      d.active = false
      ctx.audit('DEVICE_DEACTIVATED', 'device', d.id, d.code, { active: true }, { active: false })
      ctx.emit('device.updated', deviceEvent(d))
      ctx.emit('queue.updated', queueEvent(ctx.db))
      return null
    },
  },
  { method: 'GET', path: '/admin/device-types', roles: A, handler: ({ db }) => [...db.deviceTypes].sort((a, b) => a.sortOrder - b.sortOrder) },
  {
    method: 'POST',
    path: '/admin/device-types',
    roles: A,
    handler: (ctx) => {
      const { db, body } = ctx
      const code = str(body.code).toUpperCase()
      const errors: Record<string, string> = {}
      if (!/^[A-Z0-9]{2,6}$/.test(code)) errors.code = '2–6 letters or digits, e.g. VR.'
      else if (db.deviceTypes.some((t) => t.code === code)) errors.code = `${code} already exists.`
      if (str(body.name).length < 2) errors.name = 'Give it a name.'
      const cap = int(body.defaultCapacity)
      if (!(cap >= 1 && cap <= 8)) errors.defaultCapacity = 'Seats must be 1–8.'
      if (Object.keys(errors).length) fail(400, 'VALIDATION_FAILED', Object.values(errors)[0], errors)
      const t = { id: nextId(db, 'deviceTypes'), code, name: str(body.name), icon: str(body.icon) || 'monitor', defaultCapacity: cap, sortOrder: db.deviceTypes.length + 1, active: true }
      db.deviceTypes.push(t)
      ctx.audit('DEVICE_TYPE_CREATED', 'device_type', t.id, t.code, null, { name: t.name, defaultCapacity: cap })
      ctx.emit('settings.updated')
      ctx.emit('queue.updated', queueEvent(db))
      return t
    },
  },
  {
    method: 'PATCH',
    path: '/admin/device-types/:id',
    roles: A,
    handler: (ctx) => {
      const t = must(byId(ctx.db.deviceTypes, Number(ctx.params.id)), 'Device type')
      const before = { ...t }
      if ('name' in ctx.body) t.name = str(ctx.body.name) || t.name
      if ('icon' in ctx.body) t.icon = str(ctx.body.icon) || t.icon
      if ('defaultCapacity' in ctx.body) t.defaultCapacity = Math.max(1, int(ctx.body.defaultCapacity) || t.defaultCapacity)
      ctx.audit('DEVICE_TYPE_UPDATED', 'device_type', t.id, t.code, before, { ...t })
      ctx.emit('settings.updated')
      return t
    },
  },

  // Plans
  {
    method: 'GET',
    path: '/plans',
    roles: 'any',
    handler: ({ db }) => db.plans.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder).map((p) => planDto(db, p)),
  },
  {
    method: 'GET',
    path: '/admin/plans',
    roles: A,
    handler: ({ db }) => [...db.plans].sort((a, b) => a.sortOrder - b.sortOrder).map((p) => planDto(db, p)),
  },
  {
    method: 'POST',
    path: '/admin/plans',
    roles: A,
    handler: (ctx) => {
      const { db, body, now } = ctx
      const p = { id: nextId(db, 'plans'), sortOrder: db.plans.length + 1, createdAt: now, ...validatePlan(db, body, null) }
      db.plans.push(p)
      ctx.audit('PLAN_CREATED', 'plan', p.id, p.name, null, { pricePaise: p.pricePaise, durationMinutes: p.durationMinutes })
      ctx.emit('settings.updated')
      return planDto(db, p)
    },
  },
  {
    method: 'PATCH',
    path: '/admin/plans/:id',
    roles: A,
    handler: (ctx) => {
      const { db, body, params } = ctx
      const p = must(byId(db.plans, Number(params.id)), 'Plan')
      const before = { ...p }
      Object.assign(p, validatePlan(db, { ...p, ...body }, p.id))
      if (before.pricePaise !== p.pricePaise) {
        // Price edits only touch future sales — every ticket carries a snapshot (ADR-005).
        ctx.audit('PLAN_PRICE_CHANGED', 'plan', p.id, p.name, { pricePaise: before.pricePaise }, { pricePaise: p.pricePaise })
      }
      const changed = (['name', 'durationMinutes', 'description', 'active', 'deviceTypeIds', 'seatsPerTicket'] as const).filter(
        (k) => JSON.stringify(before[k]) !== JSON.stringify(p[k]),
      )
      if (changed.length) {
        ctx.audit(
          'PLAN_UPDATED',
          'plan',
          p.id,
          p.name,
          Object.fromEntries(changed.map((k) => [k, before[k]])),
          Object.fromEntries(changed.map((k) => [k, p[k]])),
        )
      }
      ctx.emit('settings.updated')
      return planDto(db, p)
    },
  },
  {
    method: 'POST',
    path: '/admin/plans/reorder',
    roles: A,
    handler: (ctx) => {
      const ids: number[] = Array.isArray(ctx.body.ids) ? ctx.body.ids : []
      ids.forEach((id, i) => {
        const p = byId(ctx.db.plans, id)
        if (p) p.sortOrder = i + 1
      })
      ctx.emit('settings.updated')
      return [...ctx.db.plans].sort((a, b) => a.sortOrder - b.sortOrder).map((p) => planDto(ctx.db, p))
    },
  },

  // Staff
  { method: 'GET', path: '/admin/users', roles: A, handler: ({ db }) => db.staff.map(staffDto) },
  {
    method: 'POST',
    path: '/admin/users',
    roles: A,
    handler: (ctx) => {
      const { db, body, now } = ctx
      const username = str(body.username).toLowerCase()
      const errors: Record<string, string> = {}
      if (!/^[a-z0-9._]{3,30}$/.test(username)) errors.username = '3–30 lowercase letters, digits, dots or underscores.'
      else if (db.staff.some((s) => s.username === username)) errors.username = `${username} is taken.`
      if (str(body.fullName).length < 2) errors.fullName = 'Enter their name.'
      if (!['ADMIN', 'RECEPTION', 'VOLUNTEER'].includes(body.role)) errors.role = 'Pick a role.'
      if (Object.keys(errors).length) fail(400, 'VALIDATION_FAILED', Object.values(errors)[0], errors)
      const temporaryPassword = tempPassword()
      const user: DbStaff = { id: nextId(db, 'staff'), username, password: temporaryPassword, fullName: str(body.fullName), role: body.role, active: true, mustChangePassword: true, lastLoginAt: null, createdAt: now }
      db.staff.push(user)
      ctx.audit('STAFF_CREATED', 'staff_user', user.id, username, null, { role: user.role })
      return { user: staffDto(user), temporaryPassword }
    },
  },
  {
    method: 'PATCH',
    path: '/admin/users/:id',
    roles: A,
    handler: (ctx) => {
      const { db, body, params, user } = ctx
      const target = must(byId(db.staff, Number(params.id)), 'User')
      const before = { fullName: target.fullName, role: target.role, active: target.active }
      if (target.id === user.id && (body.active === false || (body.role && body.role !== 'ADMIN'))) {
        fail(422, 'BUSINESS_RULE_VIOLATED', "You can't deactivate or demote your own account.")
      }
      if ('fullName' in body && str(body.fullName)) target.fullName = str(body.fullName)
      if ('role' in body && ['ADMIN', 'RECEPTION', 'VOLUNTEER'].includes(body.role)) target.role = body.role
      if ('active' in body) target.active = !!body.active
      const action = before.active && !target.active ? 'STAFF_DEACTIVATED' : !before.active && target.active ? 'STAFF_REACTIVATED' : 'STAFF_UPDATED'
      ctx.audit(action, 'staff_user', target.id, target.username, before, { fullName: target.fullName, role: target.role, active: target.active })
      return staffDto(target)
    },
  },
  {
    method: 'POST',
    path: '/admin/users/:id/reset-password',
    roles: A,
    handler: (ctx) => {
      const target = must(byId(ctx.db.staff, Number(ctx.params.id)), 'User')
      const temporaryPassword = tempPassword()
      target.password = temporaryPassword
      target.mustChangePassword = true
      ctx.audit('PASSWORD_RESET', 'staff_user', target.id, target.username)
      return { temporaryPassword }
    },
  },

  // Settings
  { method: 'GET', path: '/admin/settings', roles: A, handler: ({ db }) => db.settings },
  {
    method: 'PUT',
    path: '/admin/settings',
    roles: A,
    handler: (ctx) => {
      const { db, body } = ctx
      const errors: Record<string, string> = {}
      const range = (key: string, lo: number, hi: number, label: string) => {
        const v = int(body[key])
        if (!(v >= lo && v <= hi)) errors[key] = `${label} must be ${lo}–${hi}.`
        return v
      }
      const next = {
        eventName: str(body.eventName),
        warningThresholdMinutes: range('warningThresholdMinutes', 1, 30, 'Warning threshold'),
        cleaningAutoClearSeconds: range('cleaningAutoClearSeconds', 0, 900, 'Cleaning delay'),
        maxPauseMinutes: range('maxPauseMinutes', 0, 30, 'Pause budget'),
        allowExtensions: !!body.allowExtensions,
        maxExtensionMinutes: range('maxExtensionMinutes', 5, 120, 'Extension cap'),
        openingCashFloatPaise: range('openingCashFloatPaise', 0, 10_000_000, 'Opening float'),
        timezone: db.settings.timezone,
      }
      if (next.eventName.length < 2) errors.eventName = 'Give the event a name.'
      if (Object.keys(errors).length) fail(400, 'VALIDATION_FAILED', Object.values(errors)[0], errors)
      const before = db.settings as unknown as Record<string, unknown>
      const changed = Object.keys(next).filter((k) => before[k] !== (next as Record<string, unknown>)[k])
      if (changed.length) {
        ctx.audit(
          'SETTINGS_UPDATED',
          'event_settings',
          1,
          'Event settings',
          Object.fromEntries(changed.map((k) => [k, before[k]])),
          Object.fromEntries(changed.map((k) => [k, (next as Record<string, unknown>)[k]])),
        )
      }
      db.settings = next
      ctx.emit('settings.updated')
      return next
    },
  },

  // Audit
  {
    method: 'GET',
    path: '/admin/audit-log',
    roles: A,
    handler: ({ db, query }) => {
      const action = query.get('action')
      const userId = query.get('userId') ? Number(query.get('userId')) : null
      const from = query.get('from')
      const to = query.get('to')
      const page = Number(query.get('page') ?? 0)
      const size = 50
      const rows = [...db.audit]
        .filter((a) => !action || a.action === action)
        .filter((a) => userId === null || a.actorUserId === userId)
        .filter((a) => !from || a.occurredAt >= Date.parse(`${from}T00:00:00+05:30`))
        .filter((a) => !to || a.occurredAt < Date.parse(`${to}T00:00:00+05:30`) + 24 * 60 * MIN)
        .sort((a, b) => b.occurredAt - a.occurredAt)
      return {
        content: rows.slice(page * size, page * size + size).map((a) => {
          const actor = byId(db.staff, a.actorUserId)
          return { ...a, occurredAt: iso(a.occurredAt), actorName: actor?.fullName ?? 'System', actorRole: actor?.role ?? 'ADMIN', actorUserId: undefined }
        }),
        page,
        size,
        totalElements: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / size)),
      }
    },
  },

  ...reportRoutes,
])

function validatePlan(db: Db, body: Body, id: number | null) {
  const errors: Record<string, string> = {}
  const name = str(body.name)
  if (name.length < 2) errors.name = 'Give the plan a name.'
  else if (db.plans.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) errors.name = 'A plan with that name exists.'
  const durationMinutes = int(body.durationMinutes)
  if (!(durationMinutes >= 5 && durationMinutes <= 240)) errors.durationMinutes = 'Duration must be 5–240 minutes.'
  const pricePaise = int(body.pricePaise)
  if (!(pricePaise >= 0 && pricePaise <= 1_000_000)) errors.pricePaise = 'Enter a price.'
  const deviceTypeIds: number[] = Array.isArray(body.deviceTypeIds) ? body.deviceTypeIds.filter((x: number) => db.deviceTypes.some((t) => t.id === x)) : []
  const seatsPerTicket = int(body.seatsPerTicket ?? 1)
  if (!(seatsPerTicket >= 1 && seatsPerTicket <= 4)) errors.seatsPerTicket = 'Seats must be 1–4.'
  if (Object.keys(errors).length) fail(400, 'VALIDATION_FAILED', Object.values(errors)[0], errors)
  return { name, durationMinutes, pricePaise, description: str(body.description), deviceTypeIds, seatsPerTicket, active: body.active !== false }
}

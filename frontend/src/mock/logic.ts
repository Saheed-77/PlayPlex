import type {
  DeviceTypeSummary,
  EndReason,
  Floor,
  FloorDevice,
  FloorSession,
  NextUp,
  QueueItem,
  Role,
  SessionSummary,
  Student,
  Ticket,
  TicketDetail,
} from '@/types/api'
import { firstName } from '@/lib/utils'
import type { Db, DbDevice, DbSession, DbStudent, DbTicket } from './db'

export const MIN = 60_000
export const iso = (ms: number) => new Date(ms).toISOString()
const isoOrNull = (ms: number | null) => (ms === null ? null : iso(ms))

// ── Lookups ──────────────────────────────────────────────────────────────────
export const byId = <T extends { id: number }>(rows: T[], id: number | null | undefined) =>
  id === null || id === undefined ? undefined : rows.find((r) => r.id === id)

export const staffName = (db: Db, id: number | null) => byId(db.staff, id)?.fullName ?? 'System'
export const typeOf = (db: Db, d: DbDevice) => byId(db.deviceTypes, d.deviceTypeId)!
export const activeDevices = (db: Db) => db.devices.filter((d) => d.active)

export function activeSessionFor(db: Db, deviceId: number): DbSession | undefined {
  return db.sessions.find((s) => s.deviceId === deviceId && s.endedAt === null)
}

export function sessionTickets(db: Db, sessionId: number): DbTicket[] {
  return db.players
    .filter((p) => p.sessionId === sessionId)
    .sort((a, b) => a.seatNo - b.seatNo)
    .map((p) => byId(db.tickets, p.ticketId)!)
    .filter(Boolean)
}

export function balanceOf(db: Db, ticketId: number) {
  return db.payments.filter((p) => p.ticketId === ticketId).reduce((sum, p) => sum + p.amountPaise, 0)
}

// ── Queue (docs/02 §6.1): per device type, priority DESC then FIFO ─────────
export function queueOrder(a: DbTicket, b: DbTicket) {
  return b.priority - a.priority || a.queuedAt - b.queuedAt || a.id - b.id
}

export function eligibleQueue(db: Db, deviceTypeId: number | null): DbTicket[] {
  return db.tickets
    .filter((t) => t.status === 'QUEUED')
    .filter((t) => deviceTypeId === null || t.preferredDeviceTypeId === null || t.preferredDeviceTypeId === deviceTypeId)
    .sort(queueOrder)
}

/** Can this ticket be started on this device right now? */
export function canTake(t: DbTicket, d: DbDevice) {
  return (
    t.status === 'QUEUED' &&
    t.paymentStatus !== 'PAYMENT_DUE' &&
    (t.preferredDeviceTypeId === null || t.preferredDeviceTypeId === d.deviceTypeId) &&
    t.seatsPerTicket <= d.capacity
  )
}

/**
 * Next-up per free device. Each queued ticket is offered to at most one device, so
 * LAP-05 and LAP-09 don't both show Nithya.
 */
export function nextUpMap(db: Db): Map<number, DbTicket> {
  const taken = new Set<number>()
  const result = new Map<number, DbTicket>()
  const free = activeDevices(db)
    .filter((d) => d.status === 'AVAILABLE')
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
  const queue = eligibleQueue(db, null)
  for (const d of free) {
    const pick = queue.find((t) => !taken.has(t.id) && canTake(t, d))
    if (pick) {
      taken.add(pick.id)
      result.set(d.id, pick)
    }
  }
  return result
}

/**
 * Wait estimates. Simulates the queue draining across every device: each ticket takes
 * the earliest compatible slot. What's left over is when a newcomer would get on.
 */
export function simulateQueue(db: Db, now: number) {
  const cleanMs = db.settings.cleaningAutoClearSeconds * 1000
  const slots: { typeId: number; at: number }[] = []
  for (const d of activeDevices(db)) {
    if (d.status === 'OUT_OF_SERVICE') continue
    let at = now
    if (d.status === 'CLEANING') at = Math.max(now, d.statusChangedAt + cleanMs)
    if (d.status === 'IN_USE') {
      const s = activeSessionFor(db, d.id)
      // A paused session is assumed to resume right now: never promise the station
      // sooner than it can free up, and never inflate the queue by a pause that is
      // capped anyway (docs/02 interruptions).
      const endsAt = s?.pausedAt ? now + (s.plannedEndAt - s.pausedAt) : (s?.plannedEndAt ?? now)
      at = Math.max(now + MIN, endsAt + cleanMs)
    }
    slots.push({ typeId: d.deviceTypeId, at })
  }
  const ticketStart = new Map<number, number>()
  for (const t of eligibleQueue(db, null)) {
    let best: (typeof slots)[number] | undefined
    for (const s of slots) {
      if (t.preferredDeviceTypeId !== null && s.typeId !== t.preferredDeviceTypeId) continue
      if (!best || s.at < best.at) best = s
    }
    if (!best) continue
    ticketStart.set(t.id, best.at)
    best.at += t.durationMinutes * MIN + cleanMs
  }
  const minutesUntil = (at: number | undefined) => (at === undefined ? null : Math.max(0, Math.round((at - now) / MIN)))
  const nextFree = new Map<number, number | null>()
  for (const type of db.deviceTypes) {
    const typeSlots = slots.filter((s) => s.typeId === type.id).map((s) => s.at)
    nextFree.set(type.id, minutesUntil(typeSlots.length ? Math.min(...typeSlots) : undefined))
  }
  const all = slots.map((s) => s.at)
  return {
    ticketWait: (id: number) => minutesUntil(ticketStart.get(id)),
    typeWait: (typeId: number | null) => (typeId === null ? minutesUntil(all.length ? Math.min(...all) : undefined) : nextFree.get(typeId) ?? null),
  }
}

export function queuePosition(db: Db, t: DbTicket): number | null {
  if (t.status !== 'QUEUED') return null
  const idx = eligibleQueue(db, t.preferredDeviceTypeId).findIndex((x) => x.id === t.id)
  return idx < 0 ? null : idx + 1
}

// ── DTOs ─────────────────────────────────────────────────────────────────────
const isVolunteer = (role: Role) => role === 'VOLUNTEER'

function floorSession(db: Db, s: DbSession, role: Role): FloorSession {
  return {
    id: s.id,
    startedAt: iso(s.startedAt),
    plannedEndAt: iso(s.plannedEndAt),
    extensionMinutesTotal: s.extensionMinutesTotal,
    pausedAt: isoOrNull(s.pausedAt),
    pausedSecondsTotal: Math.round(s.pausedTotalMs / 1000),
    pauseReason: s.pauseReason,
    startedByName: staffName(db, s.startedByUserId),
    players: sessionTickets(db, s.id).map((t, i) => {
      const student = byId(db.students, t.studentId)!
      return {
        ticketId: t.id,
        ticketNo: t.ticketNo,
        displayName: isVolunteer(role) ? firstName(student.fullName) : student.fullName,
        planName: t.planName,
        durationMinutes: t.durationMinutes,
        seatNo: i + 1,
        paymentStatus: t.paymentStatus,
      }
    }),
  }
}

function nextUpDto(db: Db, t: DbTicket, now: number): NextUp {
  const student = byId(db.students, t.studentId)!
  return {
    ticketId: t.id,
    ticketNo: t.ticketNo,
    displayName: firstName(student.fullName),
    planName: t.planName,
    waitingMinutes: Math.round((now - t.queuedAt) / MIN),
    priority: t.priority,
  }
}

export function buildFloor(db: Db, now: number, role: Role): Floor {
  const devices = activeDevices(db)
  const nextUps = nextUpMap(db)
  const sim = simulateQueue(db, now)
  const queue = eligibleQueue(db, null)

  const floorDevices: FloorDevice[] = devices.map((d) => {
    const s = d.status === 'IN_USE' ? activeSessionFor(db, d.id) : undefined
    const nu = nextUps.get(d.id)
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
      statusChangedAt: iso(d.statusChangedAt),
      session: s ? floorSession(db, s, role) : null,
      nextUp: nu ? nextUpDto(db, nu, now) : null,
    }
  })

  const byDeviceType: DeviceTypeSummary[] = db.deviceTypes
    .filter((t) => t.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) => {
      const mine = devices.filter((d) => d.deviceTypeId === t.id)
      const count = (status: string) => mine.filter((d) => d.status === status).length
      return {
        id: t.id,
        code: t.code,
        name: t.name,
        icon: t.icon,
        total: mine.length,
        available: count('AVAILABLE'),
        inUse: count('IN_USE'),
        cleaning: count('CLEANING'),
        outOfService: count('OUT_OF_SERVICE'),
        queueLength: queue.filter((q) => q.preferredDeviceTypeId === t.id).length,
        estimatedWaitMinutes: sim.typeWait(t.id) ?? -1,
      }
    })

  const count = (status: string) => devices.filter((d) => d.status === status).length
  return {
    serverTime: iso(now),
    summary: {
      totalDevices: devices.length,
      available: count('AVAILABLE'),
      inUse: count('IN_USE'),
      cleaning: count('CLEANING'),
      outOfService: count('OUT_OF_SERVICE'),
      queueLength: queue.length,
      estimatedWaitMinutes: sim.typeWait(null) ?? -1,
    },
    byDeviceType,
    devices: floorDevices,
    settings: db.settings,
    duesCount: role === 'VOLUNTEER' ? 0 : db.tickets.filter((t) => t.paymentStatus === 'PAYMENT_DUE' || t.paymentStatus === 'REFUND_DUE').length,
  }
}

export function queueItems(db: Db, now: number, role: Role, deviceTypeId: number | null, q: string): QueueItem[] {
  const needle = q.trim().toLowerCase()
  return eligibleQueue(db, deviceTypeId)
    .map((t, i) => ({ t, position: i + 1, student: byId(db.students, t.studentId)! }))
    .filter(({ t, student }) => !needle || t.ticketNo.toLowerCase().includes(needle) || student.fullName.toLowerCase().includes(needle))
    .map(({ t, position, student }) => {
      const type = byId(db.deviceTypes, t.preferredDeviceTypeId)
      const item: QueueItem = {
        position,
        ticketId: t.id,
        ticketNo: t.ticketNo,
        displayName: firstName(student.fullName),
        planName: t.planName,
        durationMinutes: t.durationMinutes,
        seatsPerTicket: t.seatsPerTicket,
        preferredDeviceTypeId: t.preferredDeviceTypeId,
        preferredDeviceTypeCode: type?.code ?? null,
        priority: t.priority,
        queuedAt: iso(t.queuedAt),
        waitingMinutes: Math.round((now - t.queuedAt) / MIN),
        paymentStatus: t.paymentStatus,
      }
      // Same endpoint, different DTO by role: volunteers never receive contact details.
      if (!isVolunteer(role)) {
        item.fullName = student.fullName
        item.phone = student.phone
      }
      return item
    })
}

export function studentDto(db: Db, s: DbStudent): Student {
  const tickets = db.tickets.filter((t) => t.studentId === s.id)
  const active = tickets.find((t) => t.status === 'QUEUED' || t.status === 'ASSIGNED')
  return {
    id: s.id,
    fullName: s.fullName,
    phone: s.phone,
    rollNo: s.rollNo,
    department: s.department,
    yearOfStudy: s.yearOfStudy,
    visitCount: tickets.filter((t) => t.status !== 'CANCELLED').length,
    activeTicketNo: active?.ticketNo ?? null,
  }
}

export function ticketDto(db: Db, t: DbTicket, now: number, sim?: ReturnType<typeof simulateQueue>): Ticket {
  const student = byId(db.students, t.studentId)!
  const type = byId(db.deviceTypes, t.preferredDeviceTypeId)
  const player = t.status === 'ASSIGNED' ? db.players.find((p) => p.ticketId === t.id && p.active) : undefined
  const session = player ? byId(db.sessions, player.sessionId) : undefined
  const device = session ? byId(db.devices, session.deviceId) : undefined
  const estimate = t.status === 'QUEUED' ? (sim ?? simulateQueue(db, now)).ticketWait(t.id) : null
  return {
    id: t.id,
    ticketNo: t.ticketNo,
    student: { id: student.id, fullName: student.fullName, phone: student.phone, rollNo: student.rollNo },
    plan: { id: t.planId, name: t.planName, durationMinutes: t.durationMinutes, pricePaise: t.pricePaise },
    preferredDeviceType: type ? { id: type.id, code: type.code, name: type.name } : null,
    status: t.status,
    paymentStatus: t.paymentStatus,
    priority: t.priority,
    queuedAt: iso(t.queuedAt),
    assignedAt: isoOrNull(t.assignedAt),
    completedAt: isoOrNull(t.completedAt),
    cancelledAt: isoOrNull(t.cancelledAt),
    noShowCount: t.noShowCount,
    notes: t.notes,
    balancePaise: balanceOf(db, t.id),
    amountDuePaise: t.amountDuePaise,
    deviceCode: device?.code ?? null,
    registeredByName: staffName(db, t.registeredByUserId),
    queuePosition: queuePosition(db, t),
    estimatedWaitMinutes: estimate,
  }
}

export function ticketDetailDto(db: Db, t: DbTicket, now: number): TicketDetail {
  return {
    ...ticketDto(db, t, now),
    payments: db.payments
      .filter((p) => p.ticketId === t.id)
      .sort((a, b) => a.collectedAt - b.collectedAt)
      .map((p) => ({
        id: p.id,
        amountPaise: p.amountPaise,
        kind: p.kind,
        method: p.method,
        referenceNo: p.referenceNo,
        collectedByName: staffName(db, p.collectedByUserId),
        collectedAt: iso(p.collectedAt),
        note: p.note,
      })),
    sessions: db.players
      .filter((p) => p.ticketId === t.id)
      .map((p) => byId(db.sessions, p.sessionId)!)
      .map((s) => ({
        id: s.id,
        deviceCode: byId(db.devices, s.deviceId)?.code ?? '?',
        startedAt: iso(s.startedAt),
        plannedEndAt: iso(s.plannedEndAt),
        endedAt: isoOrNull(s.endedAt),
        endReason: s.endReason as EndReason | null,
        extensionMinutesTotal: s.extensionMinutesTotal,
      })),
  }
}

export function sessionSummary(db: Db, s: DbSession, role: Role): SessionSummary {
  const device = byId(db.devices, s.deviceId)!
  const tickets = sessionTickets(db, s.id)
  return {
    id: s.id,
    deviceCode: device.code,
    deviceTypeCode: typeOf(db, device).code,
    startedAt: iso(s.startedAt),
    plannedEndAt: iso(s.plannedEndAt),
    endedAt: isoOrNull(s.endedAt),
    endReason: s.endReason,
    extensionMinutesTotal: s.extensionMinutesTotal,
    pausedAt: isoOrNull(s.pausedAt),
    pausedSecondsTotal: Math.round(s.pausedTotalMs / 1000),
    playerNames: tickets.map((t) => {
      const name = byId(db.students, t.studentId)!.fullName
      return isVolunteer(role) ? firstName(name) : name
    }),
    ticketNos: tickets.map((t) => t.ticketNo),
    startedByName: staffName(db, s.startedByUserId),
  }
}

/** The extension price: the plan with that exact duration for this device type, most specific first. */
export function extensionPrice(db: Db, t: DbTicket, deviceTypeId: number, minutes: number): number {
  const candidates = db.plans
    .filter((p) => p.active && p.durationMinutes === minutes && p.seatsPerTicket === 1)
    .filter((p) => p.deviceTypeIds.length === 0 || p.deviceTypeIds.includes(deviceTypeId))
    .sort((a, b) => b.deviceTypeIds.length - a.deviceTypeIds.length)
  if (candidates[0]) return candidates[0].pricePaise
  return Math.round((t.pricePaise / t.durationMinutes) * minutes / 100) * 100
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

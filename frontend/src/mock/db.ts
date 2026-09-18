import type {
  DeviceStatus,
  EndReason,
  EventSettings,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  Role,
  TicketStatus,
} from '@/types/api'

// In-memory mirror of docs/03-data-model.md, persisted to localStorage so a refresh
// (or a second tab) sees the same room. Timestamps are epoch ms here and serialized
// to ISO-8601 UTC at the DTO boundary, as the real API does.

export interface DbStaff {
  id: number
  username: string
  /** Mock only. The real backend stores a BCrypt hash and never returns it. */
  password: string
  fullName: string
  role: Role
  active: boolean
  mustChangePassword: boolean
  lastLoginAt: number | null
  createdAt: number
}

export interface DbDeviceType {
  id: number
  code: string
  name: string
  icon: string
  defaultCapacity: number
  sortOrder: number
  active: boolean
}

export interface DbDevice {
  id: number
  deviceTypeId: number
  code: string
  label: string
  locationNote: string
  capacity: number
  status: DeviceStatus
  statusReason: string | null
  statusChangedAt: number
  active: boolean
  createdAt: number
}

export interface DbPlan {
  id: number
  name: string
  durationMinutes: number
  pricePaise: number
  description: string
  sortOrder: number
  active: boolean
  deviceTypeIds: number[]
  seatsPerTicket: number
  createdAt: number
}

export interface DbStudent {
  id: number
  fullName: string
  phone: string
  rollNo: string | null
  department: string | null
  yearOfStudy: number | null
  createdAt: number
}

export interface DbTicket {
  id: number
  ticketNo: string
  studentId: number
  planId: number
  // price snapshot (ADR-005)
  planName: string
  durationMinutes: number
  pricePaise: number
  seatsPerTicket: number
  preferredDeviceTypeId: number | null
  status: TicketStatus
  paymentStatus: PaymentStatus
  amountDuePaise: number
  priority: number
  queuedAt: number
  assignedAt: number | null
  completedAt: number | null
  cancelledAt: number | null
  noShowCount: number
  skippedCount: number
  registeredByUserId: number
  notes: string | null
  createdAt: number
}

export interface DbPayment {
  id: number
  ticketId: number
  amountPaise: number
  kind: PaymentKind
  method: PaymentMethod
  referenceNo: string | null
  collectedByUserId: number
  collectedAt: number
  note: string | null
}

export interface DbSession {
  id: number
  deviceId: number
  startedAt: number
  plannedEndAt: number
  endedAt: number | null
  endReason: EndReason | null
  endNote: string | null
  extensionMinutesTotal: number
  overdueNotifiedAt: number | null
  warnedAt: number | null
  startedByUserId: number
  endedByUserId: number | null
}

export interface DbSessionPlayer {
  sessionId: number
  ticketId: number
  seatNo: number
  active: boolean
}

export interface DbStatusLog {
  id: number
  deviceId: number
  fromStatus: DeviceStatus
  toStatus: DeviceStatus
  reason: string | null
  changedAt: number
  byUserId: number | null
}

export interface DbAudit {
  id: number
  actorUserId: number
  action: string
  entityType: string
  entityId: number | null
  entityLabel: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  occurredAt: number
}

export interface Db {
  schema: number
  eventStartedAt: number
  ticketSeq: number
  ids: Record<string, number>
  settings: EventSettings
  staff: DbStaff[]
  deviceTypes: DbDeviceType[]
  devices: DbDevice[]
  plans: DbPlan[]
  students: DbStudent[]
  tickets: DbTicket[]
  payments: DbPayment[]
  sessions: DbSession[]
  players: DbSessionPlayer[]
  statusLog: DbStatusLog[]
  audit: DbAudit[]
  /** Idempotency-Key → stored response, kept 24h (docs/04 §1). */
  idempotency: Record<string, { at: number; data: unknown }>
  /** Volunteer shift start per user id. */
  shifts: Record<number, number>
}

export const SCHEMA_VERSION = 3
const KEY = 'ppx.mock.db'

export function nextId(db: Db, table: string): number {
  const id = (db.ids[table] ?? 0) + 1
  db.ids[table] = id
  return id
}

export function loadDb(): Db | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const db = JSON.parse(raw) as Db
    return db.schema === SCHEMA_VERSION ? db : null
  } catch {
    return null
  }
}

export function saveDb(db: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* quota or private mode: the demo still works in memory */
  }
}

export function clearDb() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

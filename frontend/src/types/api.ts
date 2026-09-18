// API contract from docs/04-api-spec.md.
// Hand-written for now; replace with `openapi-typescript` output once the backend
// publishes its springdoc spec (docs/05 §8).

export type Role = 'VOLUNTEER' | 'RECEPTION' | 'ADMIN'
export type DeviceStatus = 'AVAILABLE' | 'IN_USE' | 'CLEANING' | 'OUT_OF_SERVICE'
export type TicketStatus = 'QUEUED' | 'ASSIGNED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'
export type PaymentStatus = 'PAID' | 'PAYMENT_DUE' | 'REFUND_DUE' | 'WAIVED' | 'REFUNDED'
export type PaymentMethod = 'CASH' | 'UPI' | 'WAIVED'
export type PaymentKind = 'INITIAL' | 'EXTENSION' | 'REFUND'
export type EndReason = 'COMPLETED' | 'ENDED_EARLY' | 'TECH_ISSUE' | 'ADMIN_OVERRIDE'
export type SkipReason = 'NOT_PRESENT' | 'WANTS_DIFFERENT_DEVICE' | 'OTHER'
/** Why play stopped. Technical faults only — a pause costs everyone in the queue. */
export type PauseReason = 'GAME_CRASH' | 'PERIPHERAL' | 'POWER' | 'NETWORK' | 'OTHER'

export interface StaffUser {
  id: number
  username: string
  fullName: string
  role: Role
  active: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface AuthResponse {
  user: StaffUser
  serverTime: string
}

export interface EventSettings {
  eventName: string
  warningThresholdMinutes: number
  cleaningAutoClearSeconds: number
  /** Pause budget per session; 0 switches pausing off entirely. */
  maxPauseMinutes: number
  allowExtensions: boolean
  maxExtensionMinutes: number
  openingCashFloatPaise: number
  timezone: string
}

export interface DeviceType {
  id: number
  code: string
  name: string
  icon: string
  defaultCapacity: number
  sortOrder: number
  active: boolean
}

export interface Plan {
  id: number
  name: string
  durationMinutes: number
  pricePaise: number
  description: string
  sortOrder: number
  active: boolean
  /** Empty = applies to every device type. */
  deviceTypeIds: number[]
  /** Seats one ticket occupies (Console Duo = 2). */
  seatsPerTicket: number
  ticketsSold?: number
}

export interface SessionPlayer {
  ticketId: number
  ticketNo: string
  displayName: string
  planName: string
  durationMinutes: number
  seatNo: number
  paymentStatus: PaymentStatus
}

export interface FloorSession {
  id: number
  startedAt: string
  plannedEndAt: string
  extensionMinutesTotal: number
  /** Set while play is stopped; the countdown freezes and plannedEndAt moves on resume. */
  pausedAt: string | null
  pausedSecondsTotal: number
  pauseReason: PauseReason | null
  startedByName: string
  players: SessionPlayer[]
}

export interface NextUp {
  ticketId: number
  ticketNo: string
  displayName: string
  planName: string
  waitingMinutes: number
  priority: number
}

export interface FloorDevice {
  id: number
  code: string
  label: string
  locationNote: string
  deviceTypeId: number
  deviceTypeCode: string
  capacity: number
  status: DeviceStatus
  statusReason: string | null
  statusChangedAt: string
  session: FloorSession | null
  nextUp: NextUp | null
}

export interface DeviceTypeSummary {
  id: number
  code: string
  name: string
  icon: string
  total: number
  available: number
  inUse: number
  cleaning: number
  outOfService: number
  queueLength: number
  estimatedWaitMinutes: number
}

export interface Floor {
  serverTime: string
  summary: {
    totalDevices: number
    available: number
    inUse: number
    cleaning: number
    outOfService: number
    queueLength: number
    estimatedWaitMinutes: number
  }
  byDeviceType: DeviceTypeSummary[]
  devices: FloorDevice[]
  /** Contract addition: the knobs every board needs, so no admin-only call is required. */
  settings: EventSettings
  duesCount: number
}

export interface QueueItem {
  position: number
  ticketId: number
  ticketNo: string
  displayName: string
  /** Reception/admin only — the serializer drops these for volunteers. */
  fullName?: string
  phone?: string
  planName: string
  durationMinutes: number
  seatsPerTicket: number
  preferredDeviceTypeId: number | null
  preferredDeviceTypeCode: string | null
  priority: number
  queuedAt: string
  waitingMinutes: number
  paymentStatus: PaymentStatus
}

export interface QueueResponse {
  serverTime: string
  deviceTypeId: number | null
  items: QueueItem[]
}

export interface Student {
  id: number
  fullName: string
  phone: string
  rollNo: string | null
  department: string | null
  yearOfStudy: number | null
  visitCount: number
  activeTicketNo: string | null
}

export interface Payment {
  id: number
  amountPaise: number
  kind: PaymentKind
  method: PaymentMethod
  referenceNo: string | null
  collectedByName: string
  collectedAt: string
  note: string | null
}

export interface Ticket {
  id: number
  ticketNo: string
  student: { id: number; fullName: string; phone: string; rollNo: string | null }
  plan: { id: number; name: string; durationMinutes: number; pricePaise: number }
  preferredDeviceType: { id: number; code: string; name: string } | null
  status: TicketStatus
  paymentStatus: PaymentStatus
  priority: number
  queuedAt: string
  assignedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  noShowCount: number
  notes: string | null
  balancePaise: number
  amountDuePaise: number
  deviceCode: string | null
  registeredByName: string
  queuePosition: number | null
  estimatedWaitMinutes: number | null
}

export interface TicketDetail extends Ticket {
  payments: Payment[]
  sessions: {
    id: number
    deviceCode: string
    startedAt: string
    plannedEndAt: string
    endedAt: string | null
    endReason: EndReason | null
    extensionMinutesTotal: number
  }[]
}

export interface CreateTicketRequest {
  student?: {
    fullName: string
    phone: string
    rollNo?: string | null
    department?: string | null
    yearOfStudy?: number | null
  }
  studentId?: number
  planId: number
  preferredDeviceTypeId: number | null
  payment: {
    method: PaymentMethod
    amountPaise: number
    referenceNo?: string | null
    note?: string | null
  }
  notes?: string | null
}

export interface Page<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export interface SessionSummary {
  id: number
  deviceCode: string
  deviceTypeCode: string
  startedAt: string
  plannedEndAt: string
  endedAt: string | null
  endReason: EndReason | null
  extensionMinutesTotal: number
  pausedAt: string | null
  pausedSecondsTotal: number
  playerNames: string[]
  ticketNos: string[]
  startedByName: string
}

export interface AdminDevice {
  id: number
  code: string
  label: string
  locationNote: string
  deviceTypeId: number
  deviceTypeCode: string
  capacity: number
  status: DeviceStatus
  statusReason: string | null
  active: boolean
  currentSession: { ticketNos: string[]; plannedEndAt: string } | null
  uptimePctToday: number
  sessionsToday: number
}

export interface AuditEntry {
  id: number
  occurredAt: string
  actorName: string
  actorRole: Role
  action: string
  entityType: string
  entityId: number | null
  entityLabel: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export interface HandoverSummary {
  userName: string
  sessionsStarted: number
  running: { deviceCode: string; plannedEndAt: string; players: string[] }[]
  overdue: { deviceCode: string; plannedEndAt: string; players: string[] }[]
  outOfService: { deviceCode: string; reason: string | null; since: string }[]
  paymentDue: { ticketNo: string; displayName: string; amountDuePaise: number }[]
}

export interface ReportSummary {
  registrations: number
  sessionsCompleted: number
  sessionsActive: number
  noShows: number
  cancellations: number
  revenue: {
    totalPaise: number
    cashPaise: number
    upiPaise: number
    refundsPaise: number
    cashRefundsPaise: number
    waivedPaise: number
    outstandingDuesPaise: number
  }
  openingCashFloatPaise: number
  utilizationPct: number
  medianWaitMinutes: number
  avgSessionMinutes: number
  overdueSessions: number
  /** Time held by paused sessions, and how many sessions were interrupted. */
  pausedMinutes: number
  pausedSessions: number
  peakHour: string | null
  registrationsLastHour: number
  byDeviceType: { code: string; name: string; sessions: number; revenuePaise: number; utilizationPct: number }[]
}

export interface RevenueReport {
  byMethod: { method: PaymentMethod; amountPaise: number; count: number }[]
  byPlan: { planName: string; amountPaise: number; tickets: number }[]
  byCollector: { name: string; amountPaise: number; count: number }[]
  hourly: { hour: string; amountPaise: number; sessions: number; registrations: number }[]
}

export interface UtilizationReport {
  byDevice: { code: string; typeCode: string; sessions: number; minutesInUse: number; minutesAvailable: number; utilizationPct: number; downMinutes: number; pausedMinutes: number }[]
  byType: { code: string; name: string; sessions: number; utilizationPct: number }[]
}

export interface QueueReport {
  medianWaitMinutes: number
  p90WaitMinutes: number
  noShowRatePct: number
  distribution: { bucket: string; count: number }[]
  longestWaits: { ticketNo: string; name: string; waitMinutes: number; skipped: number }[]
}

export type CsvExportType = 'students' | 'tickets' | 'sessions' | 'payments'

// ── Live updates (docs/04 §11) ────────────────────────────────────────────────
export type LiveEventType =
  | 'device.updated'
  | 'session.started'
  | 'session.extended'
  | 'session.paused'
  | 'session.resumed'
  | 'session.overdue'
  | 'session.ended'
  | 'queue.updated'
  | 'ticket.flagged'
  | 'settings.updated'

export interface LiveEvent {
  type: LiveEventType
  data: Record<string, unknown>
}

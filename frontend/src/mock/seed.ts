import type { PaymentMethod } from '@/types/api'
import { SCHEMA_VERSION, nextId, type Db, type DbStudent, type DbTicket } from './db'

// A believable mid-event snapshot (docs/03 §5 + the examples in docs/05), so every
// device state, the alert rail, the queue and the Dues tab have something in them the
// moment the demo opens.

const MIN = 60_000

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const FIRST_NAMES = [
  'Aditya', 'Ananya', 'Bhavya', 'Chirag', 'Deepika', 'Farhan', 'Gautam', 'Harini', 'Ishaan', 'Jaya',
  'Kavin', 'Lakshmi', 'Manoj', 'Nandini', 'Omkar', 'Pooja', 'Rohit', 'Saanvi', 'Tarun', 'Uma',
  'Varun', 'Yamini', 'Zoya', 'Abhinav', 'Keerthana', 'Surya', 'Pranav', 'Riya', 'Siddharth', 'Tanvi',
  'Vishnu', 'Akshara', 'Dhruv', 'Gayathri', 'Hari', 'Isha', 'Joel', 'Kiran', 'Meghna', 'Nikhil',
]
export const LAST_NAMES = [
  'Sharma', 'Iyer', 'Reddy', 'Nair', 'Khan', 'Patel', 'Menon', 'Das', 'Pillai', 'Rao',
  'Singh', 'Joseph', 'Krishnan', 'Varma', 'Gupta', 'Bose', 'Mathew', 'Shetty', 'Kulkarni', 'Hegde',
]
export const DEPARTMENTS = ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT', 'AIDS', 'BIOTECH']

export function createSeed(now: number): Db {
  const rand = mulberry32(20260914)
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1))

  const eventStartedAt = now - 5 * 60 * MIN
  const db: Db = {
    schema: SCHEMA_VERSION,
    eventStartedAt,
    ticketSeq: 0,
    ids: {},
    settings: {
      eventName: 'PlayPlex 2026',
      warningThresholdMinutes: 5,
      cleaningAutoClearSeconds: 90,
      maxPauseMinutes: 5,
      allowExtensions: true,
      maxExtensionMinutes: 30,
      openingCashFloatPaise: 200_000,
      timezone: 'Asia/Kolkata',
    },
    staff: [],
    deviceTypes: [],
    devices: [],
    plans: [],
    students: [],
    tickets: [],
    payments: [],
    sessions: [],
    players: [],
    statusLog: [],
    audit: [],
    idempotency: {},
    shifts: {},
  }

  // ── Staff ──────────────────────────────────────────────────────────────────
  const staff = (username: string, fullName: string, role: DbStaffRole, password = 'demo1234', active = true) => {
    const s = {
      id: nextId(db, 'staff'),
      username,
      password,
      fullName,
      role,
      active,
      mustChangePassword: false,
      lastLoginAt: active ? now - between(20, 280) * MIN : null,
      createdAt: eventStartedAt - 3 * 24 * 60 * MIN,
    }
    db.staff.push(s)
    return s
  }
  const admin = staff('admin', 'Asha Menon', 'ADMIN')
  const priya = staff('priya', 'Priya Raman', 'RECEPTION')
  const joel = staff('joel', 'Joel Thomas', 'RECEPTION')
  const meera = staff('meera', 'Meera S', 'VOLUNTEER')
  const arun = staff('arun', 'Arun Kumar', 'VOLUNTEER')
  staff('newbie', 'Rahul Dev (new)', 'VOLUNTEER').mustChangePassword = true
  staff('sam', 'Sam Wilson', 'VOLUNTEER', 'demo1234', false)
  const collectors = [priya, priya, joel, admin]
  const volunteers = [meera, meera, arun]
  db.shifts[meera.id] = now - 150 * MIN
  db.shifts[arun.id] = now - 200 * MIN

  // ── Device types, devices, plans (docs/03 §5) ─────────────────────────────
  const type = (code: string, name: string, icon: string, defaultCapacity: number) => {
    const t = { id: nextId(db, 'deviceTypes'), code, name, icon, defaultCapacity, sortOrder: db.deviceTypes.length + 1, active: true }
    db.deviceTypes.push(t)
    return t
  }
  const PS5 = type('PS5', 'PlayStation 5', 'gamepad-2', 2)
  const PC = type('PC', 'Gaming PC', 'monitor', 1)
  const SIM = type('SIM', 'Racing Simulator', 'steering-wheel', 1)
  const LAP = type('LAP', 'Laptop', 'laptop', 1)

  const device = (t: typeof PS5, code: string, label: string, locationNote: string) => {
    const d = {
      id: nextId(db, 'devices'),
      deviceTypeId: t.id,
      code,
      label,
      locationNote,
      capacity: t.defaultCapacity,
      status: 'AVAILABLE' as const,
      statusReason: null as string | null,
      statusChangedAt: eventStartedAt,
      active: true,
      createdAt: eventStartedAt - 60 * MIN,
    }
    db.devices.push(d)
    return d
  }
  const ps5 = device(PS5, 'PS5-01', 'Console corner', 'Front left, by the sofa')
  const pc = device(PC, 'PC-01', 'Main rig', 'Stage right')
  const sim = device(SIM, 'SIM-01', 'Racing rig', 'Back wall, centre')
  const laps = Array.from({ length: 10 }, (_, i) =>
    device(LAP, `LAP-${String(i + 1).padStart(2, '0')}`, `Laptop bay ${i + 1}`, i < 5 ? 'Row A, window side' : 'Row B, door side'),
  )

  const plan = (name: string, durationMinutes: number, pricePaise: number, description: string, deviceTypeIds: number[] = [], seatsPerTicket = 1) => {
    const p = {
      id: nextId(db, 'plans'),
      name,
      durationMinutes,
      pricePaise,
      description,
      sortOrder: db.plans.length + 1,
      active: true,
      deviceTypeIds,
      seatsPerTicket,
      createdAt: eventStartedAt - 24 * 60 * MIN,
    }
    db.plans.push(p)
    return p
  }
  const quick = plan('Quick Play', 15, 3000, 'A quick game between classes')
  const standard = plan('Standard', 30, 5000, 'The most popular slot')
  const marathon = plan('Marathon', 60, 9000, 'An hour of uninterrupted play')
  const sprint = plan('Sim Sprint', 15, 5000, 'Racing simulator only', [SIM.id])
  const duo = plan('Console Duo', 30, 8000, 'PS5 for two players', [PS5.id], 2)
  const plansFor = (typeId: number) => db.plans.filter((p) => p.deviceTypeIds.length === 0 || p.deviceTypeIds.includes(typeId))

  // ── Students ───────────────────────────────────────────────────────────────
  const usedPhones = new Set<string>()
  const newStudent = (fullName?: string, extra: Partial<DbStudent> = {}): DbStudent => {
    let phone = ''
    do phone = `${pick(['9', '8', '7', '6'])}${String(between(0, 999_999_999)).padStart(9, '0')}`
    while (usedPhones.has(phone))
    usedPhones.add(phone)
    const year = between(1, 4)
    const dept = pick(DEPARTMENTS)
    const s: DbStudent = {
      id: nextId(db, 'students'),
      fullName: fullName ?? `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      phone,
      rollNo: `${26 - year}${dept.slice(0, 2)}${String(between(1, 120)).padStart(3, '0')}`,
      department: dept,
      yearOfStudy: year,
      createdAt: now,
      ...extra,
    }
    usedPhones.add(s.phone)
    db.students.push(s)
    return s
  }
  const regulars = Array.from({ length: 18 }, () => newStudent())
  const studentFor = () => (rand() < 0.35 ? pick(regulars) : newStudent())

  // ── Ticket + payment helpers ───────────────────────────────────────────────
  const ticket = (student: DbStudent, p: typeof quick, queuedAt: number, preferredDeviceTypeId: number | null, method: PaymentMethod = rand() < 0.62 ? 'CASH' : 'UPI'): DbTicket => {
    student.createdAt = Math.min(student.createdAt, queuedAt)
    const collector = pick(collectors)
    const t: DbTicket = {
      id: nextId(db, 'tickets'),
      ticketNo: '',
      studentId: student.id,
      planId: p.id,
      planName: p.name,
      durationMinutes: p.durationMinutes,
      pricePaise: p.pricePaise,
      seatsPerTicket: p.seatsPerTicket,
      preferredDeviceTypeId,
      status: 'QUEUED',
      paymentStatus: method === 'WAIVED' ? 'WAIVED' : 'PAID',
      amountDuePaise: 0,
      priority: 0,
      queuedAt,
      assignedAt: null,
      completedAt: null,
      cancelledAt: null,
      noShowCount: 0,
      skippedCount: 0,
      registeredByUserId: collector.id,
      notes: null,
      createdAt: queuedAt,
    }
    db.tickets.push(t)
    db.payments.push({
      id: nextId(db, 'payments'),
      ticketId: t.id,
      amountPaise: method === 'WAIVED' ? 0 : p.pricePaise,
      kind: 'INITIAL',
      method,
      referenceNo: method === 'UPI' ? `T${String(between(1e9, 9e9))}` : null,
      collectedByUserId: collector.id,
      collectedAt: queuedAt,
      note: method === 'WAIVED' ? 'Faculty guest' : null,
    })
    return t
  }

  const session = (
    deviceId: number,
    tickets: DbTicket[],
    startedAt: number,
    opts: { endedAt?: number | null; extension?: number; by?: number; endReason?: 'COMPLETED' | 'ENDED_EARLY' | 'TECH_ISSUE' } = {},
  ) => {
    const minDuration = Math.min(...tickets.map((t) => t.durationMinutes))
    const extension = opts.extension ?? 0
    const s = {
      id: nextId(db, 'sessions'),
      deviceId,
      startedAt,
      plannedEndAt: startedAt + (minDuration + extension) * MIN,
      endedAt: opts.endedAt ?? null,
      endReason: opts.endedAt ? (opts.endReason ?? 'COMPLETED') : null,
      endNote: opts.endReason === 'TECH_ISSUE' ? 'Controller disconnected repeatedly' : null,
      extensionMinutesTotal: extension,
      pausedAt: null,
      pausedTotalMs: 0,
      pauseReason: null,
      overdueNotifiedAt: null,
      warnedAt: null,
      startedByUserId: opts.by ?? pick(volunteers).id,
      endedByUserId: opts.endedAt ? (opts.by ?? pick(volunteers).id) : null,
    }
    db.sessions.push(s)
    tickets.forEach((t, i) => {
      db.players.push({ sessionId: s.id, ticketId: t.id, seatNo: i + 1,active: !opts.endedAt })
      t.status = opts.endedAt ? 'COMPLETED' : 'ASSIGNED'
      t.assignedAt = startedAt
      t.completedAt = opts.endedAt ?? null
    })
    return s
  }

  const extensionPayment = (t: DbTicket, amount: number, at: number) => {
    db.payments.push({
      id: nextId(db, 'payments'),
      ticketId: t.id,
      amountPaise: amount,
      kind: 'EXTENSION',
      method: rand() < 0.5 ? 'CASH' : 'UPI',
      referenceNo: null,
      collectedByUserId: priya.id,
      collectedAt: at,
      note: null,
    })
  }

  // ── History: back-to-back sessions on every device until ~40 min ago ───────
  const allDevices = [ps5, pc, sim, ...laps]
  // Devices with hand-placed recent sessions below stop their history earlier so nothing overlaps.
  const historyStop: Record<number, number> = { [pc.id]: now - 62 * MIN, [laps[4].id]: now - 82 * MIN }
  for (const d of allDevices) {
    let cursor = eventStartedAt + between(2, 12) * MIN
    const stopAt = historyStop[d.id] ?? now - between(38, 70) * MIN
    for (;;) {
      const options = plansFor(d.deviceTypeId)
      const p = d.deviceTypeId === SIM.id && rand() < 0.6 ? sprint : pick(options.filter((o) => o.id !== marathon.id || rand() < 0.4))
      const wait = between(3, 26) * MIN
      const pref = rand() < 0.3 ? null : d.deviceTypeId
      const players = [ticket(studentFor(), p, cursor - wait, p.deviceTypeIds.length ? d.deviceTypeId : pref)]
      if (d.id === ps5.id && p.seatsPerTicket === 1 && rand() < 0.5) {
        players.push(ticket(studentFor(), p, cursor - wait + between(1, 4) * MIN, PS5.id))
      }
      const extended = rand() < 0.12 ? 15 : 0
      const overrun = rand() < 0.12 ? between(6, 11) : between(0, 3)
      const endedAt = cursor + (p.durationMinutes + extended + overrun) * MIN
      if (endedAt > stopAt) {
        // Too late to fit: drop the tickets we just created for it.
        for (const t of players) {
          db.tickets = db.tickets.filter((x) => x.id !== t.id)
          db.payments = db.payments.filter((x) => x.ticketId !== t.id)
        }
        break
      }
      if (extended) players.forEach((t) => extensionPayment(t, quick.pricePaise, cursor + 20 * MIN))
      session(d.id, players, cursor, { endedAt })
      cursor = endedAt + between(1, 6) * MIN
    }
  }

  // A tech-issue refund, a cancellation and some no-shows keep the reports honest.
  const cancelled = ticket(newStudent(), standard, now - 140 * MIN, LAP.id, 'CASH')
  cancelled.status = 'CANCELLED'
  cancelled.cancelledAt = now - 128 * MIN
  cancelled.paymentStatus = 'REFUNDED'
  db.payments.push({
    id: nextId(db, 'payments'), ticketId: cancelled.id, amountPaise: -standard.pricePaise, kind: 'REFUND', method: 'CASH',
    referenceNo: null, collectedByUserId: priya.id, collectedAt: now - 128 * MIN, note: 'Had to leave for a lab',
  })
  for (const mins of [95, 60]) {
    const t = ticket(newStudent(), quick, now - mins * MIN, null)
    t.status = 'NO_SHOW'
    t.noShowCount = 1
  }
  // The first PC session of the day was a faculty guest on a waived ticket.
  const firstPc = db.sessions.find((s) => s.deviceId === pc.id)
  const waived = firstPc && db.tickets.find((t) => t.id === db.players.find((p) => p.sessionId === firstPc.id)?.ticketId)
  if (waived) {
    waived.studentId = newStudent('Dr. K. Srinivasan', { rollNo: null, department: 'Faculty', yearOfStudy: null }).id
    waived.paymentStatus = 'WAIVED'
    const pay = db.payments.find((x) => x.ticketId === waived.id)!
    Object.assign(pay, { amountPaise: 0, method: 'WAIVED', referenceNo: null, note: 'Faculty guest', collectedByUserId: admin.id })
  }

  // ── The live room ──────────────────────────────────────────────────────────
  const at = (d: typeof ps5, status: 'IN_USE' | 'CLEANING' | 'OUT_OF_SERVICE', changedAt: number, reason: string | null = null) => {
    db.statusLog.push({ id: nextId(db, 'statusLog'), deviceId: d.id, fromStatus: d.status, toStatus: status, reason, changedAt, byUserId: meera.id })
    Object.assign(d, { status, statusChangedAt: changedAt, statusReason: reason })
  }
  const live = (d: typeof ps5, p: typeof quick, names: string[], remainingSec: number, opts: { extension?: number; pref?: number | null; by?: number } = {}) => {
    const total = (p.durationMinutes + (opts.extension ?? 0)) * 60_000
    const startedAt = now - total + remainingSec * 1000
    const tickets = names.map((n, i) =>
      ticket(n === 'Aravind Kumar' ? aravind : newStudent(n), p, startedAt - between(6, 20) * MIN - i * MIN, opts.pref === undefined ? d.deviceTypeId : opts.pref),
    )
    session(d.id, tickets, startedAt, { extension: opts.extension, by: opts.by })
    at(d, 'IN_USE', startedAt)
    return tickets
  }

  const aravind = newStudent('Aravind Kumar', { phone: '9876543210', rollNo: '21CS045', department: 'CSE', yearOfStudy: 3 })
  // two earlier turns for the "2 previous turns" hint
  for (const ago of [230, 120]) {
    const t = ticket(aravind, quick, now - ago * MIN, LAP.id)
    t.status = 'COMPLETED'
    t.assignedAt = now - (ago - 8) * MIN
    t.completedAt = now - (ago - 24) * MIN
  }

  live(laps[1], standard, ['Rahul Nair'], -200, { by: meera.id }) // LAP-02 overdue +03:20
  const [aravindTicket] = live(laps[0], standard, ['Aravind Kumar'], 754, { extension: 15, by: meera.id }) // LAP-01 12:34
  aravindTicket.paymentStatus = 'PAYMENT_DUE'
  aravindTicket.amountDuePaise = quick.pricePaise
  live(ps5, standard, ['Meena Iyer', 'Sanjay Rao'], 252, { by: arun.id }) // PS5-01 ending soon 04:12
  live(pc, marathon, ['Kabir Shah'], 26 * 60, { pref: null, by: arun.id })
  live(sim, sprint, ['Leela Menon'], 9 * 60 + 30, { by: arun.id })
  live(laps[3], quick, ['Aisha Khan'], 7 * 60 + 5, { by: meera.id })
  live(laps[5], standard, ['Vivek Pillai'], 21 * 60, { pref: null, by: meera.id })
  live(laps[7], marathon, ['Tara Joseph'], 38 * 60, { by: meera.id })
  live(laps[9], standard, ['Nitin Rao'], 2 * 60 + 40, { by: arun.id }) // second ending-soon
  // PC-01's game crashed 70 seconds ago: the clock is stopped and its time is safe.
  const pcSession = db.sessions.find((s) => s.deviceId === pc.id && s.endedAt === null)
  if (pcSession) {
    pcSession.pausedAt = now - 70_000
    pcSession.pauseReason = 'GAME_CRASH'
  }
  at(laps[2], 'CLEANING', now - 45_000) // LAP-03 cleaning 0:45
  at(laps[6], 'OUT_OF_SERVICE', now - 41 * MIN, 'Charger dead') // LAP-07 down for 41 min
  // LAP-05, LAP-09 stay AVAILABLE; LAP-05 shows "Next up: Nithya".

  // An earlier completed session with an unpaid extension → on the Dues tab.
  const sneha = ticket(newStudent('Sneha Kulkarni'), standard, now - 90 * MIN, LAP.id)
  session(laps[4].id, [sneha], now - 80 * MIN, { endedAt: now - 42 * MIN, extension: 30, by: meera.id })
  sneha.paymentStatus = 'PAYMENT_DUE'
  sneha.amountDuePaise = standard.pricePaise

  // A PC session cut short by a fault → requeued at priority 1, flagged for refund.
  const farhan = ticket(newStudent('Farhan Ali'), standard, now - 70 * MIN, PC.id, 'UPI')
  session(pc.id, [farhan], now - 60 * MIN, { endedAt: now - 52 * MIN, endReason: 'TECH_ISSUE', by: arun.id })
  Object.assign(farhan, { status: 'QUEUED', priority: 1, paymentStatus: 'REFUND_DUE', amountDuePaise: standard.pricePaise, completedAt: null, assignedAt: null })

  // ── The queue: 12 waiting ──────────────────────────────────────────────────
  const q = (name: string, p: typeof quick, waitingMin: number, pref: number | null, priority = 0) => {
    const t = ticket(newStudent(name), p, now - waitingMin * MIN, pref)
    t.priority = priority
    return t
  }
  q('Nithya Varma', quick, 14, LAP.id)
  q('Karthik Reddy', standard, 11, null)
  const divya = q('Divya Hegde', sprint, 9, SIM.id, 1)
  q('Rohan Gupta', duo, 17, PS5.id)
  q('Ishita Bose', standard, 8, PS5.id)
  q('Manav Shetty', marathon, 7, PC.id)
  q('Ayesha Siddiqui', quick, 6, LAP.id)
  q('Prateek Das', standard, 5, null)
  q('Lavanya Krishnan', quick, 4, LAP.id)
  q('Ravi Teja', standard, 3, SIM.id)
  q('Anjali Mathew', quick, 1, null)
  const vikram = q('Vikram Singh', quick, 25, LAP.id)
  vikram.status = 'NO_SHOW'
  vikram.noShowCount = 1

  // ── Ticket numbers in registration order ───────────────────────────────────
  for (const t of [...db.tickets].sort((a, b) => a.createdAt - b.createdAt)) {
    db.ticketSeq += 1
    t.ticketNo = `PPX-${String(db.ticketSeq).padStart(4, '0')}`
  }

  // ── Audit trail ────────────────────────────────────────────────────────────
  const audit = (actorUserId: number, action: string, entityType: string, entityId: number | null, entityLabel: string | null, before: Record<string, unknown> | null, after: Record<string, unknown> | null, occurredAt: number) =>
    db.audit.push({ id: nextId(db, 'audit'), actorUserId, action, entityType, entityId, entityLabel, before, after, occurredAt })
  audit(admin.id, 'SETTINGS_UPDATED', 'event_settings', 1, 'Event settings', { openingCashFloatPaise: 0 }, { openingCashFloatPaise: 200000 }, eventStartedAt - 20 * MIN)
  audit(admin.id, 'PLAN_PRICE_CHANGED', 'plan', marathon.id, 'Marathon', { pricePaise: 10000 }, { pricePaise: 9000 }, eventStartedAt - 15 * MIN)
  audit(admin.id, 'STAFF_CREATED', 'staff_user', joel.id, 'joel', null, { role: 'RECEPTION' }, eventStartedAt - 10 * MIN)
  audit(priya.id, 'TICKET_CANCELLED', 'ticket', cancelled.id, cancelled.ticketNo, { status: 'QUEUED' }, { status: 'CANCELLED', refund: true }, now - 128 * MIN)
  audit(meera.id, 'QUEUE_SKIPPED', 'ticket', vikram.id, vikram.ticketNo, null, { reason: 'NOT_PRESENT', device: 'LAP-06' }, now - 24 * MIN)
  audit(meera.id, 'TICKET_NO_SHOW', 'ticket', vikram.id, vikram.ticketNo, { status: 'QUEUED' }, { status: 'NO_SHOW' }, now - 23 * MIN)
  audit(arun.id, 'SESSION_ENDED', 'play_session', null, 'PC-01', null, { reason: 'TECH_ISSUE', ticket: farhan.ticketNo }, now - 52 * MIN)
  audit(meera.id, 'DEVICE_STATUS_CHANGED', 'device', laps[6].id, 'LAP-07', { status: 'AVAILABLE' }, { status: 'OUT_OF_SERVICE', reason: 'Charger dead' }, now - 41 * MIN)
  audit(admin.id, 'PRIORITY_BUMPED', 'ticket', divya.id, divya.ticketNo, { priority: 0 }, { priority: 1, reason: 'Missed her turn due to a sim fault earlier' }, now - 8 * MIN)
  audit(admin.id, 'EXPORT_DOWNLOADED', 'report', null, 'payments.csv', null, { type: 'payments' }, now - 30 * MIN)
  db.audit.sort((a, b) => a.occurredAt - b.occurredAt)

  return db
}

type DbStaffRole = 'ADMIN' | 'RECEPTION' | 'VOLUNTEER'

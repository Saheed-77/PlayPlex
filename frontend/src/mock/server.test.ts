import { beforeEach, describe, expect, it } from 'vitest'
import type { AuditEntry, Floor, Page, QueueResponse, Ticket } from '@/types/api'
import { Problem } from './router'
import { handle, resetDb, tick, userIdByUsername } from './server'

// Business rules of the mock backend, which mirror docs/02 and docs/04. These are the
// same guards the Spring backend must implement, so they double as a spec checklist.

let now = Date.parse('2026-09-14T09:00:00Z')
const as = (username: string) => {
  const id = userIdByUsername(username)
  if (!id) throw new Error(`no user ${username}`)
  return id
}
const call = <T,>(username: string, method: string, path: string, body?: unknown, idempotencyKey?: string, query?: Record<string, string>) =>
  handle({ method, path, body, asUserId: as(username), idempotencyKey, query: new URLSearchParams(query) }, now).data as T

const problem = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    if (e instanceof Problem) return e
    throw e
  }
  throw new Error('expected a Problem')
}

beforeEach(() => {
  localStorage.clear()
  resetDb()
  now = Date.parse('2026-09-14T09:00:00Z')
  // First request seeds the database.
  handle({ method: 'POST', path: '/auth/login', body: { username: 'admin', password: 'demo1234' } }, now)
})

describe('floor', () => {
  it('seeds 13 stations with every visual state represented', () => {
    const floor = call<Floor>('meera', 'GET', '/floor')
    expect(floor.summary.totalDevices).toBe(13)
    const statuses = new Set(floor.devices.map((d) => d.status))
    expect(statuses).toEqual(new Set(['AVAILABLE', 'IN_USE', 'CLEANING', 'OUT_OF_SERVICE']))
    expect(floor.devices.find((d) => d.code === 'LAP-07')?.statusReason).toBe('Charger dead')
  })

  it('never offers the same queued ticket to two free devices', () => {
    const floor = call<Floor>('meera', 'GET', '/floor')
    const offered = floor.devices.map((d) => d.nextUp?.ticketId).filter(Boolean)
    expect(new Set(offered).size).toBe(offered.length)
  })
})

describe('queue', () => {
  it('orders by priority, then FIFO', () => {
    const { items } = call<QueueResponse>('meera', 'GET', '/queue')
    const priorities = items.map((i) => i.priority)
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a))
    const normal = items.filter((i) => i.priority === 0).map((i) => Date.parse(i.queuedAt))
    expect(normal).toEqual([...normal].sort((a, b) => a - b))
  })

  it('never sends phone numbers to volunteers', () => {
    const volunteer = call<QueueResponse>('meera', 'GET', '/queue')
    expect(volunteer.items.every((i) => i.phone === undefined && i.fullName === undefined)).toBe(true)
    const reception = call<QueueResponse>('priya', 'GET', '/queue')
    expect(reception.items.every((i) => typeof i.phone === 'string')).toBe(true)
  })
})

describe('registration', () => {
  const body = {
    student: { fullName: 'New Person', phone: '9000000001' },
    planId: 2,
    preferredDeviceTypeId: null,
    payment: { method: 'CASH', amountPaise: 5000 },
  }

  it('creates one ticket per idempotency key, even on a double-click', () => {
    const a = call<Ticket>('priya', 'POST', '/tickets', body, 'key-1')
    const b = call<Ticket>('priya', 'POST', '/tickets', body, 'key-1')
    expect(a.ticketNo).toBe(b.ticketNo)
    const c = call<Ticket>('priya', 'POST', '/tickets', body, 'key-2')
    expect(c.ticketNo).not.toBe(a.ticketNo)
    expect(c.status).toBe('QUEUED')
  })

  it('rejects an amount that does not match the plan price', () => {
    const p = problem(() => call('priya', 'POST', '/tickets', { ...body, payment: { method: 'CASH', amountPaise: 100 } }, 'k'))
    expect(p.code).toBe('VALIDATION_FAILED')
  })

  it('keeps volunteers away from the desk', () => {
    const p = problem(() => call('meera', 'POST', '/tickets', body, 'k'))
    expect(p.status).toBe(403)
  })
})

describe('sessions', () => {
  it('lets exactly one of two volunteers take a free device', () => {
    const floor = call<Floor>('meera', 'GET', '/floor')
    const free = floor.devices.find((d) => d.status === 'AVAILABLE' && d.nextUp)!
    const first = call('meera', 'POST', '/sessions', { deviceId: free.id, ticketIds: [free.nextUp!.ticketId], skipReason: null }, 'a')
    expect(first).toBeTruthy()
    const { items } = call<QueueResponse>('arun', 'GET', '/queue', undefined, undefined, { deviceTypeId: String(free.deviceTypeId) })
    const p = problem(() => call('arun', 'POST', '/sessions', { deviceId: free.id, ticketIds: [items[0].ticketId], skipReason: 'OTHER' }, 'b'))
    expect(p.code).toBe('DEVICE_NOT_AVAILABLE')
  })

  it('requires a reason to skip next-up', () => {
    const floor = call<Floor>('meera', 'GET', '/floor')
    const free = floor.devices.find((d) => d.status === 'AVAILABLE' && d.nextUp)!
    const { items } = call<QueueResponse>('meera', 'GET', '/queue', undefined, undefined, { deviceTypeId: String(free.deviceTypeId) })
    const other = items.find((i) => i.ticketId !== free.nextUp!.ticketId && i.paymentStatus !== 'PAYMENT_DUE')!
    const p = problem(() => call('meera', 'POST', '/sessions', { deviceId: free.id, ticketIds: [other.ticketId], skipReason: null }, 'c'))
    expect(p.code).toBe('VALIDATION_FAILED')
    expect(call('meera', 'POST', '/sessions', { deviceId: free.id, ticketIds: [other.ticketId], skipReason: 'NOT_PRESENT' }, 'd')).toBeTruthy()
  })

  it('extends now and flags the ticket for the Dues tab', () => {
    const floor = call<Floor>('meera', 'GET', '/floor')
    const running = floor.devices.find((d) => d.code === 'LAP-06')!
    const before = Date.parse(running.session!.plannedEndAt)
    call('meera', 'POST', `/sessions/${running.session!.id}/extend`, { minutes: 15, collectPayment: false }, 'e')
    const after = call<Floor>('meera', 'GET', '/floor').devices.find((d) => d.code === 'LAP-06')!
    expect(Date.parse(after.session!.plannedEndAt) - before).toBe(15 * 60_000)
    expect(after.session!.players[0].paymentStatus).toBe('PAYMENT_DUE')
  })

  it('caps extensions at the configured maximum', () => {
    const s = call<Floor>('meera', 'GET', '/floor').devices.find((d) => d.code === 'LAP-01')!.session!
    // LAP-01 was seeded with 15 extra minutes; the cap is 30.
    const p = problem(() => call('meera', 'POST', `/sessions/${s.id}/extend`, { minutes: 30, collectPayment: false }, 'f'))
    expect(p.code).toBe('BUSINESS_RULE_VIOLATED')
  })

  it('ending sends the device to cleaning, which clears itself', () => {
    const d = call<Floor>('meera', 'GET', '/floor').devices.find((x) => x.code === 'LAP-02')!
    call('meera', 'POST', `/sessions/${d.session!.id}/end`, { reason: 'COMPLETED', note: null }, 'g')
    expect(call<Floor>('meera', 'GET', '/floor').devices.find((x) => x.code === 'LAP-02')!.status).toBe('CLEANING')
    now += 91_000
    expect(call<Floor>('meera', 'GET', '/floor').devices.find((x) => x.code === 'LAP-02')!.status).toBe('AVAILABLE')
  })

  it('a fault mid-session requeues the player at priority with a refund flag', () => {
    const d = call<Floor>('meera', 'GET', '/floor').devices.find((x) => x.code === 'LAP-06')!
    const ticketId = d.session!.players[0].ticketId
    call('meera', 'POST', `/devices/${d.id}/status`, { status: 'OUT_OF_SERVICE', reason: 'Screen died' })
    const t = call<Ticket>('priya', 'GET', `/tickets/${ticketId}`)
    expect(t.status).toBe('QUEUED')
    expect(t.priority).toBeGreaterThan(0)
    expect(t.paymentStatus).toBe('REFUND_DUE')
  })
})

describe('money', () => {
  it('a cancellation with refund nets the ticket ledger to zero', () => {
    const { items } = call<QueueResponse>('priya', 'GET', '/queue')
    const t = call<Ticket>('priya', 'POST', `/tickets/${items[items.length - 1].ticketId}/cancel`, { reason: 'Left early', refund: true })
    expect(t.status).toBe('CANCELLED')
    expect(t.balancePaise).toBe(0)
  })

  it('price edits never rewrite sold tickets', () => {
    const before = call<Ticket>('priya', 'GET', '/tickets/1')
    call('admin', 'PATCH', `/admin/plans/${before.plan.id}`, { pricePaise: before.plan.pricePaise + 1000 })
    const after = call<Ticket>('priya', 'GET', '/tickets/1')
    expect(after.plan.pricePaise).toBe(before.plan.pricePaise)
  })
})

describe('pause', () => {
  const runningDevice = (code = 'LAP-06') => call<Floor>('meera', 'GET', '/floor').devices.find((d) => d.code === code)!

  it('hands every paused second back and takes none', () => {
    const before = runningDevice()
    const plannedEnd = Date.parse(before.session!.plannedEndAt)
    call('meera', 'POST', `/sessions/${before.session!.id}/pause`, { reason: 'GAME_CRASH' }, 'p1')
    expect(runningDevice().session!.pausedAt).not.toBeNull()

    now += 3 * 60_000 + 20_000
    call('meera', 'POST', `/sessions/${before.session!.id}/resume`, {}, 'p2')
    const after = runningDevice()
    expect(after.session!.pausedAt).toBeNull()
    expect(Date.parse(after.session!.plannedEndAt) - plannedEnd).toBe(3 * 60_000 + 20_000)
    expect(after.session!.pausedSecondsTotal).toBe(200)
  })

  it('caps the budget across several pauses', () => {
    const s = runningDevice().session!
    call('meera', 'POST', `/sessions/${s.id}/pause`, { reason: 'NETWORK' }, 'a1')
    now += 4 * 60_000
    call('meera', 'POST', `/sessions/${s.id}/resume`, {}, 'a2')
    // 1 minute of budget left: a second pause is allowed...
    call('meera', 'POST', `/sessions/${s.id}/pause`, { reason: 'NETWORK' }, 'a3')
    now += 90_000
    // ...and the sweep resumes it exactly at the 5-minute cap, not later.
    const events = tick(now)
    const resumed = runningDevice()
    expect(resumed.session!.pausedAt).toBeNull()
    expect(resumed.session!.pausedSecondsTotal).toBe(5 * 60)
    expect(events.some((e) => e.type === 'session.resumed')).toBe(true)
    const log = call<Page<AuditEntry>>('admin', 'GET', '/admin/audit-log', undefined, undefined, { action: 'SESSION_AUTO_RESUMED' })
    expect(log.content.some((e) => e.entityLabel === 'LAP-06')).toBe(true)

    // Budget spent: no more pausing, and no lost-time top-up either.
    expect(problem(() => call('meera', 'POST', `/sessions/${s.id}/pause`, { reason: 'POWER' }, 'a4')).code).toBe('BUSINESS_RULE_VIOLATED')
    expect(problem(() => call('meera', 'POST', `/sessions/${s.id}/lost-time`, { minutes: 1, reason: 'POWER' }, 'a5')).code).toBe('BUSINESS_RULE_VIOLATED')
  })

  it('refuses to pause a session that is already out of time', () => {
    const overdue = call<Floor>('meera', 'GET', '/floor').devices.find((d) => d.code === 'LAP-02')!
    const p = problem(() => call('meera', 'POST', `/sessions/${overdue.session!.id}/pause`, { reason: 'POWER' }, 'o1'))
    expect(p.code).toBe('BUSINESS_RULE_VIOLATED')
  })

  it('refuses a second pause, and a resume when nothing is paused', () => {
    const s = runningDevice().session!
    expect(problem(() => call('meera', 'POST', `/sessions/${s.id}/resume`, {}, 'b0')).code).toBe('INVALID_TRANSITION')
    call('meera', 'POST', `/sessions/${s.id}/pause`, { reason: 'PERIPHERAL' }, 'b1')
    expect(problem(() => call('meera', 'POST', `/sessions/${s.id}/pause`, { reason: 'PERIPHERAL' }, 'b2')).code).toBe('INVALID_TRANSITION')
    call('meera', 'POST', `/sessions/${s.id}/resume`, {}, 'b3')
    expect(problem(() => call('meera', 'POST', `/sessions/${s.id}/resume`, {}, 'b4')).code).toBe('INVALID_TRANSITION')
  })

  it('needs a real reason, and a note when it is "other"', () => {
    const s = runningDevice().session!
    expect(problem(() => call('meera', 'POST', `/sessions/${s.id}/pause`, {}, 'c1')).code).toBe('VALIDATION_FAILED')
    expect(problem(() => call('meera', 'POST', `/sessions/${s.id}/pause`, { reason: 'OTHER' }, 'c2')).code).toBe('VALIDATION_FAILED')
    expect(call('meera', 'POST', `/sessions/${s.id}/pause`, { reason: 'OTHER', note: 'Projector fuse blew' }, 'c3')).toBeTruthy()
  })

  it('keeps reception out of it', () => {
    const s = runningDevice().session!
    expect(problem(() => call('priya', 'POST', `/sessions/${s.id}/pause`, { reason: 'POWER' }, 'd1')).status).toBe(403)
  })

  it('gives lost minutes back from the same budget', () => {
    const before = runningDevice()
    const plannedEnd = Date.parse(before.session!.plannedEndAt)
    call('meera', 'POST', `/sessions/${before.session!.id}/lost-time`, { minutes: 2, reason: 'GAME_CRASH' }, 'e1')
    const after = runningDevice()
    expect(Date.parse(after.session!.plannedEndAt) - plannedEnd).toBe(2 * 60_000)
    expect(after.session!.pausedSecondsTotal).toBe(120)
    // Only 3 of the 5 minutes are left.
    expect(problem(() => call('meera', 'POST', `/sessions/${before.session!.id}/lost-time`, { minutes: 5, reason: 'GAME_CRASH' }, 'e2')).code).toBe('BUSINESS_RULE_VIOLATED')
  })

  it('never lets a paused station look free sooner than it can be', () => {
    // PC is a single-station type and PC-01 is seeded mid-pause, so its estimate is
    // exactly that station's slot. A paused clock must not tick down towards free.
    const pcWait = () => call<Floor>('meera', 'GET', '/floor').byDeviceType.find((t) => t.code === 'PC')!.estimatedWaitMinutes
    const before = pcWait()
    now += 3 * 60_000
    expect(pcWait()).toBe(before)
    // Once it resumes, time starts counting down again.
    const pc = call<Floor>('meera', 'GET', '/floor').devices.find((d) => d.code === 'PC-01')!
    call('meera', 'POST', `/sessions/${pc.session!.id}/resume`, {}, 'f1')
    now += 5 * 60_000
    expect(pcWait()).toBeLessThan(before)
  })
})

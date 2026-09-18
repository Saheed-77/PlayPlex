import type { Floor, PaymentMethod, Plan } from '@/types/api'
import { deriveState } from '@/lib/deviceState'
import { uuid } from '@/lib/utils'
import { demoClock } from './clock'
import { eventBus } from './eventBus'
import { handle, userIdByUsername } from './server'
import { FIRST_NAMES, LAST_NAMES, DEPARTMENTS } from './seed'
import { network } from './transport'

// "Simulate traffic": a busy room acting through the same handlers the UI uses, so
// every action produces the same live events and audit rows as a real click.

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
const chance = (p: number) => Math.random() < p

function act(username: string, method: string, path: string, body?: unknown, idempotent = false) {
  const asUserId = userIdByUsername(username) ?? userIdByUsername('admin')
  try {
    const res = handle({ method, path, body, asUserId, idempotencyKey: idempotent ? uuid() : undefined }, demoClock.now())
    eventBus.publish(res.events)
    return res.data
  } catch {
    // 409s and friends are part of a busy room; the simulator just moves on.
    return null
  }
}

function step() {
  if (network.get() === 'offline') return
  const floor = act('meera', 'GET', '/floor') as Floor | null
  if (!floor) return
  const now = demoClock.now()
  const warnMs = floor.settings.warningThresholdMinutes * 60_000

  // Students arrive at the desk.
  if (chance(0.5)) {
    const plans = (act('priya', 'GET', '/plans') as Plan[] | null) ?? []
    const plan = pick(plans.filter((p) => p.seatsPerTicket === 1 || chance(0.3)))
    if (plan) {
      const types = floor.byDeviceType
      const preferred = plan.deviceTypeIds.length ? plan.deviceTypeIds[0] : chance(0.35) ? null : pick(types)?.id ?? null
      const method: PaymentMethod = chance(0.6) ? 'CASH' : 'UPI'
      act(
        chance(0.7) ? 'priya' : 'joel',
        'POST',
        '/tickets',
        {
          student: {
            fullName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
            phone: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
            rollNo: `2${Math.floor(Math.random() * 4) + 2}${pick(DEPARTMENTS).slice(0, 2)}${String(Math.floor(Math.random() * 120)).padStart(3, '0')}`,
            department: pick(DEPARTMENTS),
            yearOfStudy: Math.floor(Math.random() * 4) + 1,
          },
          planId: plan.id,
          preferredDeviceTypeId: preferred,
          payment: { method, amountPaise: plan.pricePaise, referenceNo: method === 'UPI' ? `T${Date.now()}` : null },
        },
        true,
      )
    }
  }

  // Volunteers work the floor.
  const volunteer = chance(0.6) ? 'meera' : 'arun'
  for (const d of floor.devices) {
    const { state } = deriveState(d, now, warnMs)
    if (state === 'FREE' && d.nextUp && chance(0.55)) {
      act(volunteer, 'POST', '/sessions', { deviceId: d.id, ticketIds: [d.nextUp.ticketId], skipReason: null }, true)
    } else if (state === 'OVERDUE' && d.session) {
      if (chance(0.12)) act(volunteer, 'POST', `/sessions/${d.session.id}/extend`, { minutes: 15, collectPayment: false }, true)
      else if (chance(0.5)) act(volunteer, 'POST', `/sessions/${d.session.id}/end`, { reason: 'COMPLETED', note: null }, true)
    } else if (state === 'PAUSED' && chance(0.35)) {
      act(volunteer, 'POST', `/sessions/${d.session!.id}/resume`, {}, true)
    } else if ((state === 'RUNNING' || state === 'ENDING_SOON') && chance(0.015)) {
      act(volunteer, 'POST', `/sessions/${d.session!.id}/pause`, { reason: pick(['GAME_CRASH', 'PERIPHERAL', 'NETWORK']) }, true)
    } else if (state === 'CLEANING' && chance(0.3)) {
      act(volunteer, 'POST', `/devices/${d.id}/ready`)
    } else if (state === 'OUT' && chance(0.04)) {
      act(volunteer, 'POST', `/devices/${d.id}/status`, { status: 'AVAILABLE', reason: null })
    } else if (state === 'FREE' && !d.nextUp && chance(0.004)) {
      act(volunteer, 'POST', `/devices/${d.id}/status`, { status: 'OUT_OF_SERVICE', reason: pick(['Screen flickering', 'Controller battery dead', 'Keyboard not responding']) })
    }
  }

  // Now and then a called student isn't there.
  if (chance(0.03)) {
    const head = floor.devices.find((d) => d.nextUp)?.nextUp
    if (head) act(volunteer, 'POST', `/tickets/${head.ticketId}/no-show`)
  }
}

export const simulator = {
  running: () => timer !== null,
  start() {
    if (timer) return
    timer = setInterval(step, 3000)
    step()
    listeners.forEach((l) => l())
  },
  stop() {
    if (timer) clearInterval(timer)
    timer = null
    listeners.forEach((l) => l())
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

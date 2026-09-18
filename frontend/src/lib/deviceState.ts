import type { DeviceStatus } from '@/types/api'

// The client derives running / ending-soon / overdue from plannedEndAt and the
// skew-corrected clock. The server never ships a remaining-seconds number (docs/04 §3).
export type VisualState = 'OVERDUE' | 'PAUSED' | 'ENDING_SOON' | 'FREE' | 'RUNNING' | 'CLEANING' | 'OUT'

export interface DerivedDevice {
  state: VisualState
  /** Negative once overdue. Frozen while paused. Null when there is no session. */
  remainingMs: number | null
  /** How long the current pause has run. Null unless paused. */
  pausedForMs: number | null
}

type StateInput = {
  status: DeviceStatus
  session: { plannedEndAt: string; pausedAt?: string | null } | null
}

export function deriveState(device: StateInput, now: number, warningMs: number): DerivedDevice {
  switch (device.status) {
    case 'AVAILABLE':
      return { state: 'FREE', remainingMs: null, pausedForMs: null }
    case 'CLEANING':
      return { state: 'CLEANING', remainingMs: null, pausedForMs: null }
    case 'OUT_OF_SERVICE':
      return { state: 'OUT', remainingMs: null, pausedForMs: null }
    case 'IN_USE': {
      if (!device.session) return { state: 'RUNNING', remainingMs: null, pausedForMs: null }
      const plannedEnd = +new Date(device.session.plannedEndAt)
      const pausedAt = device.session.pausedAt ? +new Date(device.session.pausedAt) : null
      // Paused: the countdown freezes at whatever was left when play stopped, and the
      // pause itself counts up. plannedEndAt moves forward again on resume.
      if (pausedAt !== null) return { state: 'PAUSED', remainingMs: plannedEnd - pausedAt, pausedForMs: Math.max(0, now - pausedAt) }
      const remainingMs = plannedEnd - now
      if (remainingMs < 0) return { state: 'OVERDUE', remainingMs, pausedForMs: null }
      if (remainingMs < warningMs) return { state: 'ENDING_SOON', remainingMs, pausedForMs: null }
      return { state: 'RUNNING', remainingMs, pausedForMs: null }
    }
  }
}

// Urgency order from docs/05 V1, with paused right behind overdue: a paused station is an
// idle station while people queue, so it has to demand attention.
const RANK: Record<VisualState, number> = { OVERDUE: 0, PAUSED: 1, ENDING_SOON: 2, FREE: 3, RUNNING: 4, CLEANING: 5, OUT: 6 }

export function sortByUrgency<T extends StateInput & { code: string }>(devices: T[], now: number, warningMs: number): T[] {
  return devices
    .map((d) => ({ d, x: deriveState(d, now, warningMs) }))
    .sort((a, b) => {
      const r = RANK[a.x.state] - RANK[b.x.state]
      if (r !== 0) return r
      // Within a state, the most urgent timer first; otherwise by code.
      if (a.x.remainingMs !== null && b.x.remainingMs !== null) return a.x.remainingMs - b.x.remainingMs
      return a.d.code.localeCompare(b.d.code, undefined, { numeric: true })
    })
    .map(({ d }) => d)
}

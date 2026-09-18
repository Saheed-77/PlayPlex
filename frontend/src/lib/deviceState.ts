import type { DeviceStatus } from '@/types/api'

// The client derives running / ending-soon / overdue from plannedEndAt and the
// skew-corrected clock. The server never ships a remaining-seconds number (docs/04 §3).
export type VisualState = 'OVERDUE' | 'ENDING_SOON' | 'FREE' | 'RUNNING' | 'CLEANING' | 'OUT'

export interface DerivedDevice {
  state: VisualState
  /** Negative once overdue. Null when there is no session. */
  remainingMs: number | null
}

type StateInput = { status: DeviceStatus; session: { plannedEndAt: string } | null }

export function deriveState(device: StateInput, now: number, warningMs: number): DerivedDevice {
  switch (device.status) {
    case 'AVAILABLE':
      return { state: 'FREE', remainingMs: null }
    case 'CLEANING':
      return { state: 'CLEANING', remainingMs: null }
    case 'OUT_OF_SERVICE':
      return { state: 'OUT', remainingMs: null }
    case 'IN_USE': {
      if (!device.session) return { state: 'RUNNING', remainingMs: null }
      const remainingMs = +new Date(device.session.plannedEndAt) - now
      if (remainingMs < 0) return { state: 'OVERDUE', remainingMs }
      if (remainingMs < warningMs) return { state: 'ENDING_SOON', remainingMs }
      return { state: 'RUNNING', remainingMs }
    }
  }
}

// Urgency order from docs/05 V1: overdue, ending soon, free, running, cleaning, out of service.
const RANK: Record<VisualState, number> = { OVERDUE: 0, ENDING_SOON: 1, FREE: 2, RUNNING: 3, CLEANING: 4, OUT: 5 }

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

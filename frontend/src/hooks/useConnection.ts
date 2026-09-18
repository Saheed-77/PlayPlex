import { useSyncExternalStore } from 'react'

// The trust signal in the top bar (docs/05 §2).
//   live          SSE connected; everything is current
//   reconnecting  SSE dropped; last-known state shown, actions disabled
//   polling       SSE gave up; refreshing every 5s, actions re-enabled
//   offline       server unreachable; switch to the paper fallback
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline'

let state: ConnectionState = 'connecting'
const listeners = new Set<() => void>()

export const connection = {
  get: () => state,
  set(next: ConnectionState) {
    if (next === state) return
    state = next
    listeners.forEach((l) => l())
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

export function useConnection(): ConnectionState {
  return useSyncExternalStore(connection.subscribe, connection.get)
}

/** A stale board is fine to look at; acting on one is not (docs/04 §11 rule 3). */
export function useCanAct(): boolean {
  const s = useConnection()
  return s === 'live' || s === 'polling'
}

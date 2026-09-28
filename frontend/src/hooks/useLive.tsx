import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Floor, LiveEvent } from '@/types/api'
import { API_MODE, openStream } from '@/api/client'
import { floorApi } from '@/api/floor'
import { useAuth } from './useAuth'
import { connection, useConnection } from './useConnection'
import { qk } from './queries'

// ── Screen-reader announcer + optional chime ────────────────────────────────
// Countdowns are aria-live="off"; state changes are announced once (docs/05 §7).
let message = ''
const msgListeners = new Set<() => void>()
export function announce(text: string) {
  // Clearing first makes a repeated message get read again.
  message = ''
  msgListeners.forEach((l) => l())
  setTimeout(() => {
    message = text
    msgListeners.forEach((l) => l())
  }, 50)
}

export function LiveAnnouncer() {
  const text = useSyncExternalStore(
    (cb) => {
      msgListeners.add(cb)
      return () => msgListeners.delete(cb)
    },
    () => message,
  )
  return (
    <div aria-live="polite" role="status" className="sr-only">
      {text}
    </div>
  )
}

let audio: AudioContext | null = null
export function chime(kind: 'soft' | 'alert' = 'alert') {
  try {
    if (localStorage.getItem('ppx.chime') !== 'true') return
    audio ??= new AudioContext()
    const notes = kind === 'alert' ? [880, 660] : [660]
    notes.forEach((freq, i) => {
      const osc = audio!.createOscillator()
      const gain = audio!.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      const t = audio!.currentTime + i * 0.18
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      osc.connect(gain).connect(audio!.destination)
      osc.start(t)
      osc.stop(t + 0.18)
    })
  } catch {
    /* audio is a nice-to-have */
  }
}

// ── Event → cache ────────────────────────────────────────────────────────────
function patchFloor(qc: QueryClient, event: LiveEvent) {
  // Events are hints, not state: patch what's obvious for instant feedback, then refetch.
  qc.setQueryData<Floor>(qk.floor, (floor) => {
    if (!floor) return floor
    const d = event.data
    switch (event.type) {
      case 'device.updated':
        return {
          ...floor,
          devices: floor.devices.map((x) =>
            x.id === d.deviceId ? { ...x, status: d.status as Floor['devices'][number]['status'], statusReason: (d.statusReason as string | null) ?? null } : x,
          ),
        }
      case 'session.extended':
        return {
          ...floor,
          devices: floor.devices.map((x) =>
            x.session && x.session.id === d.sessionId ? { ...x, session: { ...x.session, plannedEndAt: d.plannedEndAt as string } } : x,
          ),
        }
      default:
        return floor
    }
  })
}

function makeInvalidator(qc: QueryClient) {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  return (keys: string[]) => {
    keys.forEach((k) => pending.add(k))
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      for (const k of pending) qc.invalidateQueries({ queryKey: [k] })
      pending.clear()
    }, 120)
  }
}

const KEYS_FOR: Record<LiveEvent['type'], string[]> = {
  'device.updated': ['floor', 'admin', 'queue'],
  'session.started': ['floor', 'queue', 'tickets', 'sessions', 'shift'],
  'session.extended': ['floor', 'tickets', 'shift'],
  'session.paused': ['floor', 'queue', 'shift', 'admin'],
  'session.resumed': ['floor', 'queue', 'shift', 'admin'],
  'session.overdue': ['floor', 'shift'],
  'session.ended': ['floor', 'queue', 'tickets', 'sessions', 'shift', 'admin'],
  'queue.updated': ['floor', 'queue', 'tickets', 'admin'],
  'ticket.flagged': ['floor', 'tickets', 'shift', 'admin'],
  'settings.updated': ['floor', 'plans', 'admin'],
}

/**
 * Two missed beats. The server speaks every 20 seconds, so 45 is silence that means
 * something rather than a slow network.
 */
const STALE_MS = 45_000

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const state = useConnection()
  const failures = useRef(0)
  const hasBeenLive = useRef(false)
  // Bumping this tears the stream down and opens a fresh one.
  const [attempt, setAttempt] = useState(0)
  const lastSignalAt = useRef(Date.now())
  const heard = useCallback(() => {
    lastSignalAt.current = Date.now()
  }, [])

  useEffect(() => {
    if (!user) return
    const invalidate = makeInvalidator(qc)
    connection.set('connecting')
    heard()
    const close = openStream({
      onOpen: () => {
        failures.current = 0
        heard()
        // After a drop, always refetch to resync (docs/04 §11 rule 2).
        if (hasBeenLive.current) qc.invalidateQueries()
        hasBeenLive.current = true
        connection.set('live')
      },
      onError: () => {
        failures.current += 1
        const next = failures.current >= 3 ? 'polling' : 'reconnecting'
        if (connection.get() !== 'offline' || next === 'reconnecting') connection.set(next)
      },
      onHeartbeat: heard,
      onReset: () => {
        failures.current = 0
        heard()
      },
      onEvent: (event) => {
        heard()
        patchFloor(qc, event)
        invalidate(KEYS_FOR[event.type] ?? ['floor'])
        if (event.type === 'session.overdue') {
          announce(`${event.data.deviceCode} is overdue`)
          if (user.role !== 'RECEPTION') chime('alert')
        }
        if (event.type === 'ticket.flagged' && event.data.flag === 'REFUND_DUE' && user.role !== 'VOLUNTEER') {
          toast.warning(`${event.data.ticketNo} needs a refund or a reissue`, { description: 'Their session was cut short by a device fault.' })
        }
      },
    })
    return () => {
      close()
      connection.set('connecting')
    }
  }, [user, qc, attempt, heard])

  /**
   * The watchdog. `EventSource` only fires `error` when the socket actually breaks, and a
   * connection held open by a dead proxy never does — which is how a board ends up showing
   * a frozen floor under a green "Live" light. If the server has said nothing at all for
   * two beats, stop believing the light and reconnect.
   *
   * Only in `http` mode: the demo backend has no real socket, and its network controls set
   * the state directly.
   */
  useEffect(() => {
    if (!user || API_MODE !== 'http') return
    const id = setInterval(() => {
      if (connection.get() === 'offline') return
      if (Date.now() - lastSignalAt.current <= STALE_MS) return
      failures.current += 1
      connection.set(failures.current >= 3 ? 'polling' : 'reconnecting')
      lastSignalAt.current = Date.now()
      setAttempt((n) => n + 1)
    }, 5000)
    return () => clearInterval(id)
  }, [user])

  // Polling fallback: GET /floor every 5s while the stream is down.
  useEffect(() => {
    if (!user || (state !== 'polling' && state !== 'offline')) return
    const id = setInterval(async () => {
      try {
        qc.setQueryData(qk.floor, await floorApi.get())
        if (connection.get() === 'offline') {
          connection.set('polling')
          qc.invalidateQueries()
        }
      } catch {
        connection.set('offline')
      }
    }, 5000)
    return () => clearInterval(id)
  }, [user, state, qc])

  return <>{children}</>
}

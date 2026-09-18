import { serverClock, setTransport, type StreamHandlers, type Transport } from '@/api/client'
import { ApiError } from '@/api/errors'
import { demoClock } from './clock'
import { eventBus } from './eventBus'
import { Problem } from './router'
import { handle, tick } from './server'

// ── Simulated network conditions (driven from the Dev panel) ────────────────
export type NetMode = 'live' | 'reconnecting' | 'polling' | 'offline'

const NET_KEY = 'ppx.mock.net'
const netListeners = new Set<() => void>()
let netMode: NetMode = (() => {
  try {
    return (sessionStorage.getItem(NET_KEY) as NetMode) || 'live'
  } catch {
    return 'live'
  }
})()

export const network = {
  get: () => netMode,
  set(mode: NetMode) {
    netMode = mode
    try {
      sessionStorage.setItem(NET_KEY, mode)
    } catch {
      /* ignore */
    }
    netListeners.forEach((l) => l())
  },
  subscribe(fn: () => void) {
    netListeners.add(fn)
    return () => {
      netListeners.delete(fn)
    }
  },
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const latency = () => 120 + Math.random() * 230

export const mockTransport: Transport = {
  async request(method, path, body, opts) {
    await sleep(latency())
    if (netMode === 'offline') throw new TypeError('Failed to fetch')
    const query = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== '') query.set(k, String(v))
    }
    try {
      const res = handle(
        { method, path, query, body: body === undefined ? undefined : structuredClone(body), idempotencyKey: opts.idempotencyKey },
        demoClock.now(),
      )
      eventBus.publish(res.events)
      return { data: res.data === undefined ? null : structuredClone(res.data), serverTime: res.serverTime }
    } catch (err) {
      if (err instanceof Problem) throw new ApiError(err.toProblem(path))
      console.error('[mock] handler crashed', err)
      throw new ApiError({ title: 'Internal error', status: 500, code: 'INTERNAL_ERROR', detail: 'Something went wrong on the server. Try again.' })
    }
  },

  openStream(handlers: StreamHandlers) {
    let open = false
    const sync = () => {
      if (netMode === 'live') {
        if (!open) {
          open = true
          handlers.onOpen()
        }
        return
      }
      open = false
      handlers.onReset?.()
      // One failure shows "Reconnecting…"; three in a row drop to polling (docs/04 §11).
      const failures = netMode === 'reconnecting' ? 1 : 3
      for (let i = 0; i < failures; i++) handlers.onError()
    }
    const opening = setTimeout(sync, latency())
    const offNet = network.subscribe(sync)
    const offBus = eventBus.subscribe((event) => {
      if (open) handlers.onEvent(event)
    })
    return () => {
      clearTimeout(opening)
      offNet()
      offBus()
    }
  },
}

let installed = false

/** Swap the API client onto the in-browser backend and start its scheduled jobs. */
export function installMockBackend() {
  if (installed) return
  installed = true
  setTransport(mockTransport)
  serverClock.useSource(() => demoClock.now())
  setInterval(() => {
    if (netMode === 'offline') return
    eventBus.publish(tick(demoClock.now()))
  }, 2000)
}

import type { LiveEvent } from '@/types/api'
import { ApiError } from './errors'
import { httpTransport } from './http'
import type { QueryParams } from './query'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  idempotencyKey?: string
  query?: QueryParams
}

export interface StreamHandlers {
  onOpen: () => void
  onError: () => void
  onEvent: (event: LiveEvent) => void
  /** Clears the failure count (used by the mock's simulated network). */
  onReset?: () => void
}

/** Swappable backend. `http` talks to Spring Boot; `mock` runs the demo server in the browser. */
export interface Transport {
  request(method: Method, path: string, body: unknown, opts: RequestOptions): Promise<{ data: unknown; serverTime: string | null }>
  openStream(handlers: StreamHandlers): () => void
}

// ── Server clock ─────────────────────────────────────────────────────────────
// Every response carries the server time; we keep a skew offset so countdowns are
// right even when a tablet's clock is 10 minutes off (docs/02 §4.1).
let skewMs = 0
let nowSource: (() => number) | null = null

export const serverClock = {
  now: () => (nowSource ? nowSource() : Date.now() + skewMs),
  observe(serverTime: string | null) {
    if (!serverTime || nowSource) return
    const t = Date.parse(serverTime)
    if (!Number.isNaN(t)) skewMs = t - Date.now()
  },
  /** The mock backend runs its own (speed-adjustable) clock and supplies it here. */
  useSource(fn: () => number) {
    nowSource = fn
  },
}

// ── Transport selection ──────────────────────────────────────────────────────
export const API_MODE: 'mock' | 'http' = import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'mock'

let transport: Transport = httpTransport

export function setTransport(t: Transport) {
  transport = t
}

export async function api<T>(method: Method, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  try {
    const res = await transport.request(method, path, body, opts)
    serverClock.observe(res.serverTime)
    return res.data as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError({ title: 'Network error', status: 0, code: 'NETWORK_ERROR', detail: "Can't reach the server." })
  }
}

export function openStream(handlers: StreamHandlers) {
  return transport.openStream(handlers)
}

import type { LiveEventType } from '@/types/api'
import type { Transport } from './client'
import { buildQuery } from './query'
import { ApiError, type ProblemDetail } from './errors'

const EVENT_TYPES: LiveEventType[] = [
  'device.updated',
  'session.started',
  'session.extended',
  'session.overdue',
  'session.ended',
  'queue.updated',
  'ticket.flagged',
  'settings.updated',
]

/** The real backend: JSON over /api with an HttpOnly JWT cookie, SSE on /api/stream. */
export const httpTransport: Transport = {
  async request(method, path, body, opts) {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey

    const res = await fetch(`/api${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const serverTime = res.headers.get('X-Server-Time')
    const contentType = res.headers.get('Content-Type') ?? ''
    const payload = contentType.includes('json') ? await res.json() : await res.text()

    if (!res.ok) {
      const problem = (typeof payload === 'object' ? payload : null) as ProblemDetail | null
      throw new ApiError(
        problem ?? { title: res.statusText, status: res.status, code: 'INTERNAL_ERROR', detail: 'Something went wrong on the server.' },
      )
    }
    return { data: payload, serverTime }
  },

  openStream({ onOpen, onError, onEvent }) {
    const source = new EventSource('/api/stream', { withCredentials: true })
    source.onopen = onOpen
    source.onerror = onError
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (e) => {
        try {
          onEvent({ type, data: JSON.parse((e as MessageEvent).data) })
        } catch {
          onEvent({ type, data: {} })
        }
      })
    }
    return () => source.close()
  },
}

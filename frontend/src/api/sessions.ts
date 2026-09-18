import type { EndReason, SessionSummary, SkipReason } from '@/types/api'
import { api } from './client'

export interface StartSessionBody {
  deviceId: number
  ticketIds: number[]
  skipReason: SkipReason | null
}

export const sessionsApi = {
  start: (body: StartSessionBody, idempotencyKey: string) =>
    api<SessionSummary>('POST', '/sessions', body, { idempotencyKey }),
  extend: (id: number, body: { minutes: number; collectPayment: boolean }, idempotencyKey: string) =>
    api<SessionSummary>('POST', `/sessions/${id}/extend`, body, { idempotencyKey }),
  end: (id: number, body: { reason: EndReason; note: string | null }, idempotencyKey: string) =>
    api<SessionSummary>('POST', `/sessions/${id}/end`, body, { idempotencyKey }),
  forceEnd: (id: number, note: string) => api<SessionSummary>('POST', `/sessions/${id}/force-end`, { note }),
  endAll: (note: string) => api<{ ended: number }>('POST', '/sessions/end-all', { note }),
  mine: () => api<SessionSummary[]>('GET', '/sessions/mine'),
}

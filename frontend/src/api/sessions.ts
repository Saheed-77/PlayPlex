import type { EndReason, PauseReason, SessionSummary, SkipReason } from '@/types/api'
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
  /** Stops the clock during a fault; the remaining time is handed back on resume. */
  pause: (id: number, body: { reason: PauseReason; note?: string }, idempotencyKey: string) =>
    api<SessionSummary>('POST', `/sessions/${id}/pause`, body, { idempotencyKey }),
  resume: (id: number, idempotencyKey: string) =>
    api<SessionSummary>('POST', `/sessions/${id}/resume`, {}, { idempotencyKey }),
  /** After the fact: give back minutes lost to a fault, from the same budget. */
  lostTime: (id: number, body: { minutes: number; reason: PauseReason; note?: string }, idempotencyKey: string) =>
    api<SessionSummary>('POST', `/sessions/${id}/lost-time`, body, { idempotencyKey }),
  forceEnd: (id: number, note: string) => api<SessionSummary>('POST', `/sessions/${id}/force-end`, { note }),
  endAll: (note: string) => api<{ ended: number }>('POST', '/sessions/end-all', { note }),
  mine: () => api<SessionSummary[]>('GET', '/sessions/mine'),
}

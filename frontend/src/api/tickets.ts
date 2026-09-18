import type { CreateTicketRequest, Page, PaymentMethod, Student, Ticket, TicketDetail, TicketStatus } from '@/types/api'
import { api } from './client'

export interface TicketQuery {
  q?: string
  status?: TicketStatus | ''
  dues?: boolean
  page?: number
  size?: number
}

export interface SettleBody {
  kind: 'EXTENSION' | 'REFUND'
  method: PaymentMethod
  amountPaise: number
  referenceNo?: string
  note?: string
}

export const ticketsApi = {
  list: (query: TicketQuery = {}) => api<Page<Ticket>>('GET', '/tickets', undefined, { query: { ...query } }),
  get: (id: number) => api<TicketDetail>('GET', `/tickets/${id}`),
  create: (body: CreateTicketRequest, idempotencyKey: string) => api<Ticket>('POST', '/tickets', body, { idempotencyKey }),
  update: (id: number, body: { preferredDeviceTypeId?: number | null; notes?: string | null }) =>
    api<Ticket>('PATCH', `/tickets/${id}`, body),
  cancel: (id: number, body: { reason: string; refund: boolean; method?: PaymentMethod }) =>
    api<Ticket>('POST', `/tickets/${id}/cancel`, body),
  settle: (id: number, body: SettleBody, idempotencyKey: string) =>
    api<TicketDetail>('POST', `/tickets/${id}/payments`, body, { idempotencyKey }),
  noShow: (id: number) => api<Ticket>('POST', `/tickets/${id}/no-show`),
  requeue: (id: number) => api<Ticket>('POST', `/tickets/${id}/requeue`),
  setPriority: (id: number, priority: number, reason: string) =>
    api<Ticket>('POST', `/tickets/${id}/priority`, { priority, reason }),
}

export const studentsApi = {
  search: (q: string) => api<Student[]>('GET', '/students', undefined, { query: { q } }),
}

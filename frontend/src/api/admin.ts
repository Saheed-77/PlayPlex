import type { AuditEntry, EventSettings, Page, Plan, Role, StaffUser } from '@/types/api'
import { api } from './client'

export interface PlanInput {
  name: string
  durationMinutes: number
  pricePaise: number
  description: string
  deviceTypeIds: number[]
  seatsPerTicket: number
  active: boolean
}

export const plansApi = {
  active: () => api<Plan[]>('GET', '/plans'),
  all: () => api<Plan[]>('GET', '/admin/plans'),
  create: (body: PlanInput) => api<Plan>('POST', '/admin/plans', body),
  update: (id: number, body: Partial<PlanInput>) => api<Plan>('PATCH', `/admin/plans/${id}`, body),
  reorder: (ids: number[]) => api<Plan[]>('POST', '/admin/plans/reorder', { ids }),
}

export const staffApi = {
  list: () => api<StaffUser[]>('GET', '/admin/users'),
  create: (body: { username: string; fullName: string; role: Role }) =>
    api<{ user: StaffUser; temporaryPassword: string }>('POST', '/admin/users', body),
  update: (id: number, body: { fullName?: string; role?: Role; active?: boolean }) =>
    api<StaffUser>('PATCH', `/admin/users/${id}`, body),
  resetPassword: (id: number) => api<{ temporaryPassword: string }>('POST', `/admin/users/${id}/reset-password`),
}

export const settingsApi = {
  get: () => api<EventSettings>('GET', '/admin/settings'),
  update: (body: EventSettings) => api<EventSettings>('PUT', '/admin/settings', body),
}

export interface AuditQuery {
  action?: string
  userId?: number | ''
  from?: string
  to?: string
  page?: number
}

export const auditApi = {
  list: (query: AuditQuery) => api<Page<AuditEntry>>('GET', '/admin/audit-log', undefined, { query: { ...query } }),
}

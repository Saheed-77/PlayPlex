import type { AuthResponse, HandoverSummary, StaffUser } from '@/types/api'
import { api } from './client'

export const authApi = {
  login: (username: string, password: string) => api<AuthResponse>('POST', '/auth/login', { username, password }),
  logout: () => api<void>('POST', '/auth/logout'),
  me: () => api<AuthResponse>('GET', '/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<StaffUser>('POST', '/auth/change-password', { currentPassword, newPassword }),
  /** Handover summary for the outgoing volunteer (docs/02 §8). */
  shiftSummary: () => api<HandoverSummary>('GET', '/shift/summary'),
  endShift: () => api<HandoverSummary>('POST', '/shift/end'),
}

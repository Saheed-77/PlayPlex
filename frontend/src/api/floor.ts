import type { Floor, QueueResponse } from '@/types/api'
import { api } from './client'

export const floorApi = {
  get: () => api<Floor>('GET', '/floor'),
  queue: (params: { deviceTypeId?: number | null; q?: string } = {}) =>
    api<QueueResponse>('GET', '/queue', undefined, { query: params }),
}

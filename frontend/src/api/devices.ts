import type { AdminDevice, DeviceStatus, DeviceType } from '@/types/api'
import { api } from './client'

export interface DeviceInput {
  deviceTypeId: number
  code: string
  label: string
  locationNote: string
  capacity: number
}

export interface DeviceTypeInput {
  code: string
  name: string
  icon: string
  defaultCapacity: number
}

export const devicesApi = {
  setStatus: (id: number, status: DeviceStatus, reason: string | null) =>
    api<void>('POST', `/devices/${id}/status`, { status, reason }),
  ready: (id: number) => api<void>('POST', `/devices/${id}/ready`),

  adminList: () => api<AdminDevice[]>('GET', '/admin/devices'),
  suggestCode: (deviceTypeId: number) =>
    api<{ code: string }>('GET', '/admin/devices/suggest-code', undefined, { query: { deviceTypeId } }),
  create: (body: DeviceInput) => api<AdminDevice>('POST', '/admin/devices', body),
  update: (id: number, body: Partial<DeviceInput> & { active?: boolean }) => api<AdminDevice>('PATCH', `/admin/devices/${id}`, body),
  remove: (id: number) => api<void>('DELETE', `/admin/devices/${id}`),

  types: () => api<DeviceType[]>('GET', '/admin/device-types'),
  createType: (body: DeviceTypeInput) => api<DeviceType>('POST', '/admin/device-types', body),
  updateType: (id: number, body: Partial<DeviceTypeInput>) => api<DeviceType>('PATCH', `/admin/device-types/${id}`, body),
}

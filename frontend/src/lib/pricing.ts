import type { Plan } from '@/types/api'

/**
 * What reception will collect for an extension: the single-seat plan with exactly that
 * duration for the device type, most specific first. Mirrors the backend rule so the
 * volunteer sees the same number reception will.
 */
export function extensionPricePaise(plans: Plan[], deviceTypeId: number, minutes: number, fallbackRate?: { pricePaise: number; durationMinutes: number }): number | null {
  const match = plans
    .filter((p) => p.active && p.durationMinutes === minutes && p.seatsPerTicket === 1)
    .filter((p) => p.deviceTypeIds.length === 0 || p.deviceTypeIds.includes(deviceTypeId))
    .sort((a, b) => b.deviceTypeIds.length - a.deviceTypeIds.length)[0]
  if (match) return match.pricePaise
  if (!fallbackRate) return null
  return Math.round(((fallbackRate.pricePaise / fallbackRate.durationMinutes) * minutes) / 100) * 100
}

export function plansForType(plans: Plan[], deviceTypeId: number | null): Plan[] {
  return plans.filter((p) => p.active && (p.deviceTypeIds.length === 0 || (deviceTypeId !== null && p.deviceTypeIds.includes(deviceTypeId))))
}

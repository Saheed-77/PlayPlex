import type { Role } from '@/types/api'

export const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Admin', RECEPTION: 'Reception', VOLUNTEER: 'Volunteer' }

export function homePath(role: Role): string {
  return role === 'ADMIN' ? '/admin' : role === 'RECEPTION' ? '/reception/register' : '/floor'
}

/** Admin can do everything; other roles only what they are listed for. */
export function hasRole(role: Role | undefined, allowed: Role[]): boolean {
  if (!role) return false
  return role === 'ADMIN' || allowed.includes(role)
}

/** Assign / end / extend / device status: volunteers and admin, never reception. */
export const canOperateFloor = (role: Role | undefined) => role === 'VOLUNTEER' || role === 'ADMIN'

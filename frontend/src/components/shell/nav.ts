import { BarChart3, ClipboardList, Cpu, HandCoins, History, LayoutDashboard, LayoutGrid, Settings, Tags, Ticket, Timer, Users, type LucideIcon } from 'lucide-react'
import type { Role } from '@/types/api'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  roles: Role[]
  badge?: 'dues'
}

// The UI hides what a role can't do — a courtesy; the server check is the security.
export const NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN'] },
  { to: '/reception/register', label: 'Register', icon: Ticket, roles: ['RECEPTION', 'ADMIN'] },
  { to: '/reception/registrations', label: 'Registrations', icon: ClipboardList, roles: ['RECEPTION', 'ADMIN'] },
  { to: '/reception/dues', label: 'Dues', icon: HandCoins, roles: ['RECEPTION', 'ADMIN'], badge: 'dues' },
  { to: '/floor', label: 'Floor board', icon: LayoutGrid, roles: ['VOLUNTEER', 'RECEPTION', 'ADMIN'] },
  { to: '/volunteer/shift', label: 'My shift', icon: Timer, roles: ['VOLUNTEER'] },
  { to: '/admin/devices', label: 'Devices', icon: Cpu, roles: ['ADMIN'] },
  { to: '/admin/plans', label: 'Plans & pricing', icon: Tags, roles: ['ADMIN'] },
  { to: '/admin/staff', label: 'Staff', icon: Users, roles: ['ADMIN'] },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3, roles: ['ADMIN'] },
  { to: '/admin/settings', label: 'Settings', icon: Settings, roles: ['ADMIN'] },
  { to: '/admin/audit', label: 'Audit log', icon: History, roles: ['ADMIN'] },
]

export const navFor = (role: Role) => NAV.filter((n) => n.roles.includes(role))

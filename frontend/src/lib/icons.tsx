import { Car, Gamepad2, Glasses, Joystick, Laptop, Monitor, Puzzle, Tv, type LucideIcon } from 'lucide-react'

// device_type.icon stores a lucide name; these are the ones admin can pick from.
export const DEVICE_ICONS: Record<string, LucideIcon> = {
  'gamepad-2': Gamepad2,
  monitor: Monitor,
  'steering-wheel': Car,
  laptop: Laptop,
  glasses: Glasses,
  joystick: Joystick,
  puzzle: Puzzle,
  tv: Tv,
}

export function DeviceTypeIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = DEVICE_ICONS[icon] ?? Monitor
  return <Icon className={className} aria-hidden />
}

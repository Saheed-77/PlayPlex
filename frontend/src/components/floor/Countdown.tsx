import { formatDuration } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * Remaining time from plannedEndAt and the shared ticker. Counts down, then counts
 * UP with a "+" once overdue. tabular-nums stops digits jittering; aria-live is off
 * because a screen reader reading every second is unusable (docs/05 §7).
 */
export function Countdown({ remainingMs, className }: { remainingMs: number; className?: string }) {
  const overdue = remainingMs < 0
  const text = overdue ? `+${formatDuration(-remainingMs)}` : formatDuration(remainingMs)
  return (
    <span aria-live="off" className={cn('font-bold tabular-nums tracking-tight', className)}>
      {text}
    </span>
  )
}

import { Users } from 'lucide-react'
import type { Floor } from '@/types/api'
import { DeviceTypeIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/primitives'

/** Free devices don't mean "now" if people are already queued for them — trust the estimate. */
export function waitLabel(minutes: number): string {
  if (minutes < 0) return 'unavailable'
  if (minutes === 0) return 'NOW'
  return `~${minutes} min`
}

/**
 * R3 — answers "how long for a laptop?" before the student reaches the desk.
 * Live via SSE; read-only for reception.
 */
export function AvailabilityStrip({ floor, className }: { floor?: Floor; className?: string }) {
  if (!floor) return <Skeleton className={cn('h-20', className)} />
  return (
    <section aria-label="Live availability" className={cn('rounded-xl border bg-card p-2', className)}>
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        {floor.byDeviceType.map((t) => {
          const now = t.estimatedWaitMinutes === 0
          return (
            <li key={t.id} className={cn('flex items-center gap-3 rounded-lg px-3 py-2', now ? 'bg-free-bg' : 'bg-muted/60')}>
              <DeviceTypeIcon icon={t.icon} className={cn('size-6 shrink-0', now ? 'text-free' : 'text-muted-foreground')} />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold leading-tight">
                    {t.name}
                  </span>
                  <span className={cn('shrink-0 text-sm font-bold tabular-nums', now ? 'text-free' : 'text-foreground')}>{waitLabel(t.estimatedWaitMinutes)}</span>
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  <span className={cn('font-semibold', now ? 'text-free' : 'text-foreground')}>
                    {t.available}/{t.total} free
                  </span>
                  {t.outOfService > 0 && <span> · {t.outOfService} down</span>}
                </p>
              </div>
            </li>
          )
        })}
        <li className="flex items-center gap-3 rounded-lg bg-run-bg px-3 py-2">
          <Users className="size-6 shrink-0 text-run" aria-hidden />
          <div>
            <p className="text-sm font-semibold">Queue</p>
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground tabular-nums">{floor.summary.queueLength}</strong> waiting
            </p>
          </div>
        </li>
      </ul>
    </section>
  )
}

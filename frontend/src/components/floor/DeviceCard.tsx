import { Ban, Circle, EllipsisVertical, Hourglass, Pause, Play, Plus, Sparkles, Square, Star, Timer, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react'
import type { FloorDevice } from '@/types/api'
import { deriveState, type VisualState } from '@/lib/deviceState'
import { formatClock, formatDuration } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/primitives'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays'
import { Countdown } from './Countdown'

// Colour + icon + label for every state (docs/05 §1, P2).
export const STATE_STYLE: Record<VisualState, { icon: LucideIcon; label: string; card: string; accent: string }> = {
  OVERDUE: { icon: TriangleAlert, label: 'Overdue', card: 'bg-over-bg border-over motion-safe:animate-alarm', accent: 'text-over' },
  PAUSED: { icon: Pause, label: 'Paused', card: 'bg-pause-bg border-pause', accent: 'text-pause' },
  ENDING_SOON: { icon: Timer, label: 'Ending soon', card: 'bg-soon-bg border-soon motion-safe:animate-soft-pulse', accent: 'text-soon' },
  FREE: { icon: Circle, label: 'Free', card: 'bg-free-bg border-free/60', accent: 'text-free' },
  RUNNING: { icon: Play, label: 'In use', card: 'bg-run-bg border-run/30', accent: 'text-run' },
  CLEANING: { icon: Sparkles, label: 'Cleaning', card: 'bg-clean-bg border-clean/40', accent: 'text-clean' },
  OUT: { icon: Ban, label: 'Out of service', card: 'bg-out-bg border-out/30 opacity-70', accent: 'text-out' },
}

export interface DeviceActions {
  onAssign: (d: FloorDevice) => void
  onEnd: (d: FloorDevice) => void
  onExtend: (d: FloorDevice, minutes: number) => void
  onReady: (d: FloorDevice) => void
  onFixed: (d: FloorDevice) => void
  onStatus: (d: FloorDevice, status: 'CLEANING' | 'OUT_OF_SERVICE') => void
  onPause: (d: FloorDevice) => void
  onResume: (d: FloorDevice) => void
  onLostTime: (d: FloorDevice) => void
  onForceEnd?: (d: FloorDevice) => void
}

interface Props {
  device: FloorDevice
  now: number
  warningMs: number
  /** Role may act on the floor (volunteer/admin), not read-only reception. */
  operable: boolean
  /** Connection allows acting right now. */
  canAct: boolean
  extendable: boolean
  /** Pause budget for one session; 0 means pausing is switched off. */
  maxPauseMs: number
  actions: DeviceActions
}

export function DeviceCard({ device, now, warningMs, operable, canAct, extendable, maxPauseMs, actions }: Props) {
  const { state, remainingMs, pausedForMs } = deriveState(device, now, warningMs)
  const style = STATE_STYLE[state]
  const Icon = style.icon
  const s = device.session
  const players = s?.players ?? []
  const owes = players.some((p) => p.paymentStatus === 'PAYMENT_DUE')
  const disabled = !canAct
  // Budget left for this session, counting the pause currently running.
  const pauseLeftMs = s ? Math.max(0, maxPauseMs - s.pausedSecondsTotal * 1000 - (pausedForMs ?? 0)) : 0
  const pausable = maxPauseMs > 0 && pauseLeftMs > 0 && (state === 'RUNNING' || state === 'ENDING_SOON')

  return (
    <article
      aria-label={`${device.code}, ${style.label}`}
      className={cn('relative flex min-h-56 flex-col rounded-xl border-2 p-3 transition-colors', style.card)}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={cn('flex items-center gap-1.5 text-base font-bold', style.accent)}>
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className="truncate text-foreground">{device.code}</span>
          </div>
          <p className="truncate text-xs text-muted-foreground" title={device.locationNote}>
            {device.label}
            {device.capacity > 1 && ` · ${device.capacity} seats`}
          </p>
        </div>
        {operable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="-mr-1 -mt-1 shrink-0" aria-label={`More actions for ${device.code}`} disabled={disabled}>
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{device.code}</DropdownMenuLabel>
              {state === 'FREE' && (
                <DropdownMenuItem onSelect={() => actions.onStatus(device, 'CLEANING')}>
                  <Sparkles /> Needs cleaning
                </DropdownMenuItem>
              )}
              {state !== 'OUT' && (
                <DropdownMenuItem destructive onSelect={() => actions.onStatus(device, 'OUT_OF_SERVICE')}>
                  <Wrench /> Report a fault…
                </DropdownMenuItem>
              )}
              {s && state !== 'PAUSED' && maxPauseMs > 0 && (
                <DropdownMenuItem disabled={pauseLeftMs < 60_000} onSelect={() => actions.onLostTime(device)}>
                  <Hourglass /> Add lost time…
                </DropdownMenuItem>
              )}
              {s && actions.onForceEnd && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => actions.onForceEnd?.(device)}>
                    <Square /> Force end (admin)…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="flex flex-1 flex-col items-center justify-center py-2 text-center">
        {remainingMs !== null ? (
          <Countdown remainingMs={remainingMs} className={cn('text-4xl', style.accent)} />
        ) : state === 'FREE' ? (
          <span className={cn('text-3xl font-extrabold tracking-wide', style.accent)}>FREE</span>
        ) : state === 'CLEANING' ? (
          <span className={cn('text-xl font-extrabold tracking-wide', style.accent)}>
            CLEANING <span className="tabular-nums">{formatDuration(now - +new Date(device.statusChangedAt))}</span>
          </span>
        ) : (
          <>
            <span className={cn('text-lg font-extrabold leading-tight tracking-wide', style.accent)}>OUT OF SERVICE</span>
            {device.statusReason && <span className="mt-1 text-sm">{device.statusReason}</span>}
          </>
        )}
        <span className={cn('mt-1 text-[11px] font-bold uppercase tracking-widest', style.accent)}>{state === 'FREE' || state === 'CLEANING' || state === 'OUT' ? '' : style.label}</span>
        {state === 'PAUSED' && (
          <span className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            held · paused {formatDuration(pausedForMs ?? 0)} of {formatDuration(maxPauseMs)}
          </span>
        )}
      </div>

      <div className="mb-3 min-h-11 text-sm">
        {s ? (
          <>
            <p className="truncate font-semibold">{players.map((p) => p.displayName).join(' · ')}</p>
            <p className="truncate text-xs text-muted-foreground">
              {players[0]?.planName} · until {formatClock(s.plannedEndAt)}
              {s.extensionMinutesTotal > 0 && ` · +${s.extensionMinutesTotal}m`}
            </p>
            {owes && (
              <Badge tone="over" className="mt-1">
                Pay at desk
              </Badge>
            )}
          </>
        ) : state === 'FREE' ? (
          device.nextUp ? (
            <>
              <p className="text-xs text-muted-foreground">Next up</p>
              <p className="truncate font-semibold">
                {device.nextUp.priority > 0 && <Star className="mr-1 inline size-3.5 fill-soon text-soon" aria-label="Priority" />}
                {device.nextUp.displayName} <span className="font-mono text-xs text-muted-foreground">{device.nextUp.ticketNo}</span>
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">No one waiting for this</p>
          )
        ) : state === 'OUT' ? (
          <p className="text-xs text-muted-foreground">Down since {formatClock(device.statusChangedAt)}</p>
        ) : null}
      </div>

      {operable && (
        <footer className={cn('grid gap-2', state === 'PAUSED' || pausable ? 'grid-cols-3' : 'grid-cols-2')}>
          {state === 'PAUSED' ? (
            <>
              <Button className="col-span-2" disabled={disabled} onClick={() => actions.onResume(device)}>
                <Play /> Resume
              </Button>
              <Button variant="secondary" disabled={disabled} onClick={() => actions.onEnd(device)}>
                <Square /> End
              </Button>
            </>
          ) : s ? (
            <>
              <Button variant={state === 'OVERDUE' ? 'destructive' : 'secondary'} disabled={disabled} onClick={() => actions.onEnd(device)}>
                <Square /> End
              </Button>
              <Button variant="outline" disabled={disabled || !extendable} onClick={() => actions.onExtend(device, 15)} title={extendable ? undefined : 'No more extension time available'}>
                <Plus /> 15
              </Button>
              {/* Pause sits in the footer, not the overflow menu: during an outage every tap counts. */}
              {pausable && (
                <Button variant="outline" disabled={disabled} onClick={() => actions.onPause(device)} title={`Stop the clock · ${formatDuration(pauseLeftMs)} of pause left`}>
                  <Pause /> Pause
                </Button>
              )}
            </>
          ) : state === 'FREE' ? (
            <Button className="col-span-2" disabled={disabled} onClick={() => actions.onAssign(device)}>
              Assign
            </Button>
          ) : state === 'CLEANING' ? (
            <Button className="col-span-2" variant="secondary" disabled={disabled} onClick={() => actions.onReady(device)}>
              <Sparkles /> Ready
            </Button>
          ) : (
            <Button className="col-span-2" variant="outline" disabled={disabled} onClick={() => actions.onFixed(device)}>
              <Wrench /> Fixed
            </Button>
          )}
        </footer>
      )}
    </article>
  )
}

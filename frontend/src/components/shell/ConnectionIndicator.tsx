import { CloudOff, LoaderCircle, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useConnection, type ConnectionState } from '@/hooks/useConnection'
import { cn } from '@/lib/utils'

const META: Record<ConnectionState, { label: string; dot: string; text: string; icon: typeof Wifi; hint: string }> = {
  connecting: { label: 'Connecting…', dot: 'bg-muted-foreground', text: 'text-muted-foreground', icon: LoaderCircle, hint: 'Opening the live connection' },
  live: { label: 'Live', dot: 'bg-free', text: 'text-free', icon: Wifi, hint: 'Connected. Everything you see is current.' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-soon', text: 'text-soon', icon: RefreshCw, hint: 'Showing last-known state. Actions are disabled.' },
  polling: { label: 'Polling', dot: 'bg-run', text: 'text-run', icon: RefreshCw, hint: 'Live updates failed; refreshing every 5 seconds.' },
  offline: { label: 'Offline', dot: 'bg-over', text: 'text-over', icon: CloudOff, hint: 'Server unreachable. Use the paper fallback.' },
}

/** The single most important trust signal in the app (docs/05 §2). */
export function ConnectionIndicator({ className }: { className?: string }) {
  const state = useConnection()
  const m = META[state]
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold', m.text, className)} title={m.hint} role="status" aria-label={`Connection: ${m.label}. ${m.hint}`}>
      <span className="relative flex size-2.5">
        {state === 'live' && <span className={cn('absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping', m.dot)} />}
        <span className={cn('relative inline-flex size-2.5 rounded-full', m.dot)} />
      </span>
      {m.label}
    </span>
  )
}

export function ConnectionBanner() {
  const state = useConnection()
  if (state === 'live' || state === 'connecting') return null
  const m = META[state]
  const Icon = state === 'offline' ? WifiOff : m.icon
  const tone = state === 'offline' ? 'border-over bg-over-bg' : state === 'reconnecting' ? 'border-soon bg-soon-bg' : 'border-run/50 bg-run-bg'
  return (
    <div role="alert" className={cn('no-print flex items-center gap-2 border-b-2 px-4 py-2 text-sm', tone)}>
      <Icon className={cn('size-4 shrink-0', m.text, state === 'reconnecting' && 'motion-safe:animate-spin')} aria-hidden />
      <strong className={m.text}>{m.label}</strong>
      <span className="text-foreground/90">
        {state === 'reconnecting' && 'Lost the live connection. The board shows the last-known state and buttons are paused until it’s back.'}
        {state === 'polling' && 'Live updates are down, so the board refreshes every 5 seconds. You can keep working.'}
        {state === 'offline' && 'Can’t reach the server. Switch to the paper sheets and backfill later.'}
      </span>
    </div>
  )
}

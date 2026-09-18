import { useEffect, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FastForward, FlaskConical, RotateCcw, X } from 'lucide-react'
import type { Role } from '@/types/api'
import { useAuth } from '@/hooks/useAuth'
import { useFloor } from '@/hooks/queries'
import { homePath, ROLE_LABEL } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Chip, Separator } from '@/components/ui/primitives'
import { Switch } from '@/components/ui/overlays'
import { demoClock } from '@/mock/clock'
import { resetDb } from '@/mock/server'
import { simulator } from '@/mock/simulator'
import { network, type NetMode } from '@/mock/transport'

// Demo controls. Only rendered when VITE_API_MODE=mock.

const ACCOUNTS: { username: string; role: Role; name: string }[] = [
  { username: 'admin', role: 'ADMIN', name: 'Asha' },
  { username: 'priya', role: 'RECEPTION', name: 'Priya' },
  { username: 'meera', role: 'VOLUNTEER', name: 'Meera' },
]

const NET_MODES: { value: NetMode; label: string }[] = [
  { value: 'live', label: 'Live' },
  { value: 'reconnecting', label: 'Drop SSE' },
  { value: 'polling', label: 'Polling' },
  { value: 'offline', label: 'Offline' },
]

function useStore<T>(subscribe: (cb: () => void) => () => void, get: () => T) {
  return useSyncExternalStore(subscribe, get)
}

export default function DevPanel() {
  const [open, setOpen] = useState(false)
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const floor = useFloor()
  const speed = useStore(demoClock.subscribe, demoClock.speed)
  const running = useStore(simulator.subscribe, simulator.running)
  const net = useStore(network.subscribe, network.get)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const switchTo = async (username: string) => {
    try {
      const u = await login(username, 'demo1234')
      navigate(homePath(u.role), { replace: true })
      toast.success(`Signed in as ${u.fullName} (${ROLE_LABEL[u.role]})`)
    } catch {
      toast.error('Could not switch user — was the password changed? Reset the demo.')
    }
  }

  const pushOverdue = () => {
    // Jump the demo clock so the next running session tips past its end time.
    const running = floor.data?.devices.filter((d) => d.session).map((d) => +new Date(d.session!.plannedEndAt)) ?? []
    const soonest = Math.min(...running.filter((t) => t > demoClock.now()))
    const jump = Number.isFinite(soonest) ? soonest - demoClock.now() + 20_000 : 5 * 60_000
    demoClock.advance(jump)
    qc.invalidateQueries()
    toast(`Clock moved forward ${Math.round(jump / 60_000)} min`)
  }

  const reset = () => {
    simulator.stop()
    network.set('live')
    demoClock.reset()
    resetDb()
    try {
      sessionStorage.removeItem('ppx.mock.auth')
    } catch {
      /* ignore */
    }
    window.location.assign('/login')
  }

  return (
    <div className="no-print fixed bottom-4 left-4 z-40">
      {open ? (
        <div className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border bg-popover p-4 shadow-2xl" role="dialog" aria-label="Demo controls">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 font-bold">
              <FlaskConical className="size-4 text-primary" /> Demo controls
            </p>
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="Close demo controls">
              <X />
            </Button>
          </div>

          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sign in as</p>
          <div className="mb-3 grid grid-cols-3 gap-1.5">
            {ACCOUNTS.map((a) => (
              <Chip key={a.username} selected={user?.username === a.username} onClick={() => switchTo(a.username)} className="h-auto flex-col gap-0 px-2 py-1.5">
                <span>{a.name}</span>
                <span className="text-[10px] font-normal opacity-75">{ROLE_LABEL[a.role]}</span>
              </Chip>
            ))}
          </div>

          <Separator className="my-3" />
          <label className="mb-3 flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold">Simulate traffic</span>
              <span className="block text-xs text-muted-foreground">Students arrive, volunteers assign and end sessions</span>
            </span>
            <Switch checked={running} onCheckedChange={(v) => (v ? simulator.start() : simulator.stop())} />
          </label>

          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clock speed</p>
          <div className="mb-2 flex gap-1.5">
            {[1, 10, 60].map((s) => (
              <Chip key={s} selected={speed === s} onClick={() => demoClock.setSpeed(s)} className="h-9 flex-1">
                {s}×
              </Chip>
            ))}
          </div>
          <Button variant="outline" size="sm" className="mb-3 w-full" onClick={pushOverdue}>
            <FastForward /> Jump to the next session end
          </Button>

          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Network</p>
          <div className="mb-3 grid grid-cols-4 gap-1.5">
            {NET_MODES.map((m) => (
              <Chip key={m.value} selected={net === m.value} onClick={() => network.set(m.value)} className={cn('h-9 px-1 text-xs')}>
                {m.label}
              </Chip>
            ))}
          </div>

          <Separator className="my-3" />
          <Button variant="ghost" size="sm" className="w-full text-destructive" onClick={reset}>
            <RotateCcw /> Reset demo data
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">Open a second tab to see live updates between devices.</p>
        </div>
      ) : (
        <Button onClick={() => setOpen(true)} className={cn('rounded-full shadow-lg', running && 'ring-2 ring-soon')} aria-label="Open demo controls">
          <FlaskConical /> Demo{speed > 1 && ` · ${speed}×`}
        </Button>
      )}
    </div>
  )
}

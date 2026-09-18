import { Suspense, lazy, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bell, BellOff, ChevronDown, KeyRound, LogOut, Moon, Sun, Timer } from 'lucide-react'
import { authApi } from '@/api/auth'
import { API_MODE, serverClock } from '@/api/client'
import { useAuth, useUser } from '@/hooks/useAuth'
import { qk, useFloor } from '@/hooks/queries'
import { useMediaQuery, useStoredState } from '@/hooks/useUtils'
import { demoPanelEnabled } from '@/lib/demoFlag'
import { ROLE_LABEL } from '@/lib/roles'
import { formatClock } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/primitives'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays'
import { ResponsiveDialog } from '@/components/common/common'
import { ConnectionBanner, ConnectionIndicator } from './ConnectionIndicator'
import { navFor } from './nav'
import { HandoverSummaryView } from '@/pages/volunteer/HandoverSummary'

// Mock-only: loaded lazily so a real-backend build never ships the demo server.
const DevPanel = lazy(() => import('./DevPanel'))
// Read once per page load, so a hosted demo shows the controls only with ?demo=1.
const showDemoPanel = API_MODE === 'mock' && demoPanelEnabled()

export function useTheme(): ['dark' | 'light', () => void] {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('ppx.theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-black tracking-[0.18em]', className)}>
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
          <path d="M5 3v10l8-5z" fill="currentColor" />
        </svg>
      </span>
      PLAYPLEX
    </span>
  )
}

export function AppShell() {
  const user = useUser()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [theme, toggleTheme] = useTheme()
  const [chimeOn, setChimeOn] = useStoredState('ppx.chime', false)
  const [handoverOpen, setHandoverOpen] = useState(false)
  const floor = useFloor()
  const items = navFor(user.role)
  const dues = floor.data?.duesCount ?? 0

  const endShift = useQuery({ queryKey: qk.shift, queryFn: authApi.shiftSummary, enabled: handoverOpen })

  const signOut = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const navLinks = (onClick?: () => void) =>
    items.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/admin'}
        onClick={onClick}
        className={({ isActive }) =>
          cn(
            'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors',
            isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )
        }
      >
        <item.icon className="size-4.5 shrink-0" aria-hidden />
        <span className="flex-1">{item.label}</span>
        {item.badge === 'dues' && dues > 0 && (
          <Badge tone="over" aria-label={`${dues} outstanding`}>
            {dues}
          </Badge>
        )}
      </NavLink>
    ))

  return (
    <div className="min-h-dvh">
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
        <NavLink to="/" className="shrink-0" aria-label="PlayPlex home">
          <Wordmark className="text-sm" />
        </NavLink>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">{floor.data?.settings.eventName}</span>
        <ConnectionIndicator />
        <div className="flex-1" />
        <span className="hidden text-sm sm:inline">
          <strong>{user.fullName}</strong> <span className="text-muted-foreground">· {ROLE_LABEL[user.role]}</span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-10">
              Menu <ChevronDown />
              {!desktop && dues > 0 && <span className="size-2 rounded-full bg-over" aria-label="Dues outstanding" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64">
            <DropdownMenuLabel>
              {user.fullName} · {ROLE_LABEL[user.role]}
            </DropdownMenuLabel>
            {!desktop && (
              <>
                {items.map((item) => (
                  <DropdownMenuItem key={item.to} onSelect={() => navigate(item.to)}>
                    <item.icon /> <span className="flex-1">{item.label}</span>
                    {item.badge === 'dues' && dues > 0 && <Badge tone="over">{dues}</Badge>}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            {user.role === 'VOLUNTEER' && (
              <DropdownMenuItem onSelect={() => setHandoverOpen(true)}>
                <Timer /> End shift…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={toggleTheme}>
              {theme === 'dark' ? <Sun /> : <Moon />} {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </DropdownMenuItem>
            {user.role !== 'RECEPTION' && (
              <DropdownMenuItem onSelect={() => setChimeOn(!chimeOn)}>
                {chimeOn ? <BellOff /> : <Bell />} {chimeOn ? 'Turn chime off' : 'Turn chime on'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => navigate('/change-password')}>
              <KeyRound /> Change password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={signOut}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <ConnectionBanner />

      <div className="flex">
        {desktop && items.length > 2 && (
          <nav aria-label="Main" className="no-print sticky top-14 h-[calc(100dvh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r p-3">
            <div className="grid gap-1">{navLinks()}</div>
          </nav>
        )}
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6">
          {desktop && items.length <= 2 && <div className="mb-4 flex gap-1">{navLinks()}</div>}
          <Outlet />
        </main>
      </div>

      <ResponsiveDialog
        open={handoverOpen}
        onOpenChange={setHandoverOpen}
        title="End your shift"
        description={`Clear what you can, then hand the tablet over. It’s ${formatClock(serverClock.now())}.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setHandoverOpen(false)}>
              Keep working
            </Button>
            <Button
              onClick={async () => {
                try {
                  await authApi.endShift()
                  toast.success('Shift ended. Thanks!', { description: 'Your handover is in the audit log.' })
                  setHandoverOpen(false)
                  await signOut()
                } catch {
                  toast.error('Could not end the shift. Try again.')
                }
              }}
            >
              <LogOut /> End shift & sign out
            </Button>
          </>
        }
      >
        <HandoverSummaryView summary={endShift.data} loading={endShift.isPending} />
      </ResponsiveDialog>

      {showDemoPanel && (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      )}
    </div>
  )
}

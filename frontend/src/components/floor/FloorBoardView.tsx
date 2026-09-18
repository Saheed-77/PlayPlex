import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ListOrdered, Plus, Square, TriangleAlert } from 'lucide-react'
import type { FloorDevice } from '@/types/api'
import { devicesApi } from '@/api/devices'
import { useApiMutation, useFloor } from '@/hooks/queries'
import { useServerNow } from '@/hooks/useServerNow'
import { useCanAct } from '@/hooks/useConnection'
import { useMediaQuery, useStoredState } from '@/hooks/useUtils'
import { announce, chime } from '@/hooks/useLive'
import { useUser } from '@/hooks/useAuth'
import { deriveState, sortByUrgency, type VisualState } from '@/lib/deviceState'
import { DeviceTypeIcon } from '@/lib/icons'
import { formatDuration } from '@/lib/time'
import { canOperateFloor } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/common'
import { DeviceCard, type DeviceActions } from './DeviceCard'
import { QueuePanel } from './QueuePanel'
import { AssignSheet } from './AssignSheet'
import { EndDialog, ExtendDialog, FaultDialog } from './SessionDialogs'

/**
 * V1 — the floor board. Queue on the left, devices on the right, ordered by urgency.
 * Used by volunteers (operable), admin (operable + overrides) and reception (read-only).
 */
export function FloorBoardView({ readOnly = false, compact = false }: { readOnly?: boolean; compact?: boolean }) {
  const user = useUser()
  const floor = useFloor()
  const now = useServerNow()
  const canAct = useCanAct()
  const operable = !readOnly && canOperateFloor(user.role)
  const [typeFilter, setTypeFilter] = useStoredState<number | null>('ppx.floor.type', null)
  const desktop = useMediaQuery('(min-width: 1024px)')
  const tablet = useMediaQuery('(min-width: 640px)')
  const [queueOpen, setQueueOpen] = useState(false)

  const [assigning, setAssigning] = useState<FloorDevice | null>(null)
  const [ending, setEnding] = useState<{ device: FloorDevice; forced: boolean } | null>(null)
  const [extending, setExtending] = useState<{ device: FloorDevice; minutes: number } | null>(null)
  const [faulting, setFaulting] = useState<FloorDevice | null>(null)

  const settings = floor.data?.settings
  const warningMs = (settings?.warningThresholdMinutes ?? 5) * 60_000

  const ready = useApiMutation((d: FloorDevice) => devicesApi.ready(d.id), {
    onSuccess: (_, d) => toast.success(`${d.code} is ready`),
  })
  const fixed = useApiMutation((d: FloorDevice) => devicesApi.setStatus(d.id, 'AVAILABLE', null), {
    onSuccess: (_, d) => toast.success(`${d.code} is back in service`),
  })
  const cleaning = useApiMutation((d: FloorDevice) => devicesApi.setStatus(d.id, 'CLEANING', null), {
    onSuccess: (_, d) => toast.success(`${d.code} marked for cleaning`),
  })

  const extensionLeft = (d: FloorDevice) => (settings?.allowExtensions ? settings.maxExtensionMinutes - (d.session?.extensionMinutesTotal ?? 0) : 0)

  const actions: DeviceActions = {
    onAssign: setAssigning,
    onEnd: (device) => setEnding({ device, forced: false }),
    onExtend: (device, minutes) => setExtending({ device, minutes }),
    onReady: (d) => ready.mutate(d),
    onFixed: (d) => fixed.mutate(d),
    onStatus: (d, status) => (status === 'CLEANING' ? cleaning.mutate(d) : setFaulting(d)),
    onForceEnd: user.role === 'ADMIN' ? (device) => setEnding({ device, forced: true }) : undefined,
  }

  const devices = floor.data?.devices ?? []
  const visible = useMemo(
    () => sortByUrgency(devices.filter((d) => typeFilter === null || d.deviceTypeId === typeFilter), now, warningMs),
    [devices, typeFilter, now, warningMs],
  )
  const overdue = useMemo(() => sortByUrgency(devices, now, warningMs).filter((d) => deriveState(d, now, warningMs).state === 'OVERDUE'), [devices, now, warningMs])

  useStateAnnouncements(devices, now, warningMs, operable)

  if (floor.isPending) return <LoadingRows rows={6} />
  if (floor.isError) return <ErrorState error={floor.error} onRetry={() => floor.refetch()} />
  const data = floor.data
  // If admin deleted the type we were filtered to, fall back to all.
  const activeFilter = typeFilter !== null && data.byDeviceType.some((t) => t.id === typeFilter) ? typeFilter : null

  const grid = (
    <div>
      <div className="sticky top-14 z-10 -mx-1 mb-3 bg-background/90 px-1 py-2 backdrop-blur">
        <div role="tablist" aria-label="Filter by device type" className="flex gap-1 overflow-x-auto">
          {[{ id: null as number | null, code: 'ALL', icon: '', name: 'All devices', available: data.summary.available, total: data.summary.totalDevices }, ...data.byDeviceType].map((t) => (
            <button
              key={t.code}
              role="tab"
              aria-selected={activeFilter === t.id}
              onClick={() => setTypeFilter(t.id)}
              className={cn(
                'inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors',
                activeFilter === t.id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {t.icon && <DeviceTypeIcon icon={t.icon} className="size-4" />}
              {t.id === null ? 'All' : t.code}
              <span className="text-xs font-normal opacity-80 tabular-nums">
                {t.available}/{t.total}
              </span>
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="No devices of this type" description="Admin can add one from the Devices page." />
      ) : (
        <div className={cn('grid gap-3', compact ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-5' : 'grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4')}>
          {visible.map((d) => (
            <DeviceCard key={d.id} device={d} now={now} warningMs={warningMs} operable={operable} canAct={canAct} extendable={extensionLeft(d) >= 15} actions={actions} />
          ))}
        </div>
      )}
    </div>
  )

  const queuePanel = <QueuePanel typeFilter={activeFilter} types={data.byDeviceType} operable={operable} className="h-full" />

  return (
    <div>
      {overdue.length > 0 && (
        <AlertRail devices={overdue} now={now} operable={operable} canAct={canAct} canExtend={(d) => extensionLeft(d) >= 15} actions={actions} />
      )}

      {desktop ? (
        <div className="grid grid-cols-[18rem_1fr] gap-5 xl:grid-cols-[20rem_1fr]">
          <aside className="sticky top-16 h-[calc(100dvh-5rem)] overflow-hidden">{queuePanel}</aside>
          {grid}
        </div>
      ) : tablet ? (
        <>
          <Button variant="outline" className="mb-2" onClick={() => setQueueOpen(true)}>
            <ListOrdered /> Queue ({data.summary.queueLength})
          </Button>
          {grid}
          <Dialog open={queueOpen} onOpenChange={setQueueOpen}>
            <DialogContent className="left-0 top-0 h-dvh max-h-dvh w-[22rem] max-w-[90vw] translate-x-0 translate-y-0 rounded-none rounded-r-2xl p-4">
              <DialogTitle className="sr-only">Queue</DialogTitle>
              <DialogDescription className="sr-only">Everyone waiting, in order</DialogDescription>
              {queuePanel}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <Tabs defaultValue="devices">
          <TabsList className="mb-3 grid w-full grid-cols-2">
            <TabsTrigger value="devices" className="h-10">
              Devices ({data.summary.available} free)
            </TabsTrigger>
            <TabsTrigger value="queue" className="h-10">
              Queue ({data.summary.queueLength})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="devices">{grid}</TabsContent>
          <TabsContent value="queue">{queuePanel}</TabsContent>
        </Tabs>
      )}

      {operable && (
        <>
          <AssignSheet device={assigning} onClose={() => setAssigning(null)} />
          <EndDialog device={ending?.device ?? null} forced={ending?.forced} onClose={() => setEnding(null)} />
          <ExtendDialog
            device={extending?.device ?? null}
            minutes={extending?.minutes ?? 15}
            maxRemaining={extending ? extensionLeft(extending.device) : 30}
            onClose={() => setExtending(null)}
          />
          <FaultDialog device={faulting} onClose={() => setFaulting(null)} />
        </>
      )}
    </div>
  )
}

/** Every overdue session with inline End/+15. Hidden entirely when nothing is wrong. */
function AlertRail({ devices, now, operable, canAct, canExtend, actions }: { devices: FloorDevice[]; now: number; operable: boolean; canAct: boolean; canExtend: (d: FloorDevice) => boolean; actions: DeviceActions }) {
  return (
    <div role="alert" className="mb-4 grid gap-2">
      {devices.map((d) => {
        const over = now - +new Date(d.session!.plannedEndAt)
        return (
          <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-over bg-over-bg px-3 py-2 motion-safe:animate-banner-in">
            <TriangleAlert className="size-5 shrink-0 text-over" aria-hidden />
            <p className="min-w-0 flex-1 text-sm sm:text-base">
              <strong>{d.code}</strong> is <strong className="tabular-nums text-over">{formatDuration(over)}</strong> overdue — {d.session!.players.map((p) => p.displayName).join(' & ')}
            </p>
            {operable && (
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" disabled={!canAct} onClick={() => actions.onEnd(d)}>
                  <Square /> End
                </Button>
                <Button size="sm" variant="outline" disabled={!canAct || !canExtend(d)} onClick={() => actions.onExtend(d, 15)}>
                  <Plus /> 15
                </Button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Announce each state change once ("LAP-01 ending soon"), with an optional soft chime. */
function useStateAnnouncements(devices: FloorDevice[], now: number, warningMs: number, audible: boolean) {
  const previous = useRef(new Map<number, VisualState>())
  useEffect(() => {
    const seen = previous.current
    const first = seen.size === 0
    for (const d of devices) {
      const { state } = deriveState(d, now, warningMs)
      const before = seen.get(d.id)
      seen.set(d.id, state)
      if (first || before === state) continue
      if (state === 'ENDING_SOON') {
        announce(`${d.code} ending soon`)
        if (audible) chime('soft')
      }
    }
  }, [devices, now, warningMs, audible])
}

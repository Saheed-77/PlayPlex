import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Play, Star, UserRound } from 'lucide-react'
import type { FloorDevice, QueueItem, SkipReason } from '@/types/api'
import { floorApi } from '@/api/floor'
import { sessionsApi } from '@/api/sessions'
import { ApiError, friendlyMessage } from '@/api/errors'
import { qk } from '@/hooks/queries'
import { useServerNow } from '@/hooks/useServerNow'
import { useIdempotencyKey } from '@/hooks/useUtils'
import { useCanAct } from '@/hooks/useConnection'
import { announce } from '@/hooks/useLive'
import { formatClock, formatMinutes } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge, Chip } from '@/components/ui/primitives'
import { LoadingRows, ResponsiveDialog, SearchInput } from '@/components/common/common'

const SKIP_REASONS: { value: SkipReason; label: string }[] = [
  { value: 'NOT_PRESENT', label: 'Not present' },
  { value: 'WANTS_DIFFERENT_DEVICE', label: 'Wants a different device' },
  { value: 'OTHER', label: 'Other' },
]

/** V2 — two taps on the happy path: Assign → Start (docs/05 V2). */
export function AssignSheet({ device, onClose }: { device: FloorDevice | null; onClose: () => void }) {
  const open = device !== null
  const now = useServerNow()
  const canAct = useCanAct()
  const qc = useQueryClient()
  const [key, rotateKey] = useIdempotencyKey()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [skipReason, setSkipReason] = useState<SkipReason | null>(null)
  const [busy, setBusy] = useState(false)
  const startRef = useRef<HTMLButtonElement>(null)

  const typeId = device?.deviceTypeId ?? null
  const queue = useQuery({
    queryKey: ['queue', 'assign', typeId],
    queryFn: () => floorApi.queue({ deviceTypeId: typeId }),
    enabled: typeId !== null,
  })

  // Next-up is preselected every time the sheet opens.
  useEffect(() => {
    if (device) {
      setSelected(device.nextUp ? [device.nextUp.ticketId] : [])
      setSkipReason(null)
      setSearch('')
    }
  }, [device])

  const items = queue.data?.items ?? []
  const byId = useMemo(() => new Map(items.map((i) => [i.ticketId, i])), [items])
  const chosen = selected.map((id) => byId.get(id)).filter((x): x is QueueItem => !!x)
  const seatsUsed = chosen.reduce((n, t) => n + t.seatsPerTicket, 0)
  const capacity = device?.capacity ?? 1
  const nextUpId = device?.nextUp?.ticketId
  const skipping = nextUpId !== undefined && !selected.includes(nextUpId)
  const minutes = chosen.length ? Math.min(...chosen.map((t) => t.durationMinutes)) : 0
  const needle = search.trim().toLowerCase()
  const visible = items.filter((i) => !needle || i.ticketNo.toLowerCase().includes(needle) || i.displayName.toLowerCase().includes(needle))

  const blockedReason = (item: QueueItem) => {
    if (item.paymentStatus === 'PAYMENT_DUE') return 'Pay at desk first'
    if (item.seatsPerTicket > capacity) return `Needs ${item.seatsPerTicket} seats`
    return null
  }

  const toggle = (item: QueueItem) => {
    if (blockedReason(item)) return
    setSelected((cur) => {
      if (cur.includes(item.ticketId)) return cur.filter((id) => id !== item.ticketId)
      if (capacity === 1) return [item.ticketId]
      const used = cur.reduce((n, id) => n + (byId.get(id)?.seatsPerTicket ?? 1), 0)
      if (used + item.seatsPerTicket > capacity) return [...cur.slice(1), item.ticketId].slice(-capacity)
      return [...cur, item.ticketId]
    })
  }

  const start = async () => {
    if (!device) return
    setBusy(true)
    try {
      await sessionsApi.start({ deviceId: device.id, ticketIds: selected, skipReason: skipping ? skipReason : null }, key)
      rotateKey()
      toast.success(`${device.code} started`, { description: `${chosen.map((c) => c.displayName).join(' & ')} · ${minutes} min` })
      announce(`${device.code} started`)
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DEVICE_NOT_AVAILABLE') {
        // Two volunteers, one device: close, explain, refresh — never a raw error (docs/02 §4.2).
        onClose()
        rotateKey()
      }
      toast.error(friendlyMessage(err))
    } finally {
      setBusy(false)
      qc.invalidateQueries({ queryKey: qk.floor })
      qc.invalidateQueries({ queryKey: ['queue'] })
    }
  }

  const ready = selected.length > 0 && seatsUsed <= capacity && (!skipping || skipReason !== null) && canAct

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Assign ${device?.code ?? ''}`}
      description={device ? `${device.label}${capacity > 1 ? ` · ${capacity} seats` : ''}` : undefined}
      className="sm:max-w-lg"
      // Focus Start, not the search box: no keyboard popping up on the happy path.
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        startRef.current?.focus()
      }}
      footer={
        <Button ref={startRef} size="lg" className="w-full" disabled={!ready} loading={busy} onClick={start}>
          <Play /> Start session
        </Button>
      }
    >
      {capacity > 1 && (
        <div className="grid grid-cols-2 gap-2" aria-label="Seats">
          {Array.from({ length: capacity }, (_, seat) => {
            let cursor = 0
            const occupant = chosen.find((c) => {
              const hit = seat >= cursor && seat < cursor + c.seatsPerTicket
              cursor += c.seatsPerTicket
              return hit
            })
            return (
              <div key={seat} className={cn('rounded-lg border-2 border-dashed p-2 text-sm', occupant && 'border-solid border-primary bg-primary/10')}>
                <div className="text-xs text-muted-foreground">Seat {seat + 1}</div>
                <div className="truncate font-semibold">{occupant ? occupant.displayName : 'Empty — pick a player'}</div>
              </div>
            )
          })}
          <p className="col-span-2 text-xs text-muted-foreground">
            Leaving a seat empty is fine. {chosen.length > 1 && `Session ends when the shorter plan ends (${minutes} min).`}
          </p>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{device?.nextUp ? 'Next up, then the rest of the queue' : 'Queue for this device'}</p>
        <SearchInput value={search} onChange={setSearch} placeholder="Search for someone else…" />
      </div>

      {queue.isPending ? (
        <LoadingRows rows={3} />
      ) : visible.length === 0 ? (
        <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">
          <UserRound className="mx-auto mb-1 size-6" aria-hidden />
          {items.length ? 'No match in the queue.' : 'No one is waiting for this device.'}
        </p>
      ) : (
        <ul className="grid max-h-72 gap-2 overflow-y-auto" role="listbox" aria-multiselectable={capacity > 1} aria-label="Queued tickets">
          {visible.map((item) => {
            const isSelected = selected.includes(item.ticketId)
            const blocked = blockedReason(item)
            return (
              <li key={item.ticketId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={!!blocked}
                  onClick={() => toggle(item)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    isSelected ? 'border-primary bg-primary/10' : 'border-transparent bg-muted/60 hover:bg-muted',
                  )}
                >
                  <span className="w-6 text-center text-sm font-bold text-muted-foreground">{item.position}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <span className="font-mono text-xs text-muted-foreground">{item.ticketNo}</span>
                      <span className="truncate">{item.fullName ?? item.displayName}</span>
                      {item.priority > 0 && <Star className="size-3.5 shrink-0 fill-soon text-soon" aria-label="Priority" />}
                      {item.ticketId === nextUpId && <Badge tone="primary">Next up</Badge>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.planName} · {item.durationMinutes} min{item.seatsPerTicket > 1 && ` · ${item.seatsPerTicket} seats`} · waiting {formatMinutes(item.waitingMinutes)}
                    </span>
                    {blocked && <span className="text-xs font-semibold text-over">{blocked}</span>}
                  </span>
                  {isSelected && <Check className="size-5 shrink-0 text-primary" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {skipping && selected.length > 0 && (
        <div className="rounded-lg border border-soon/50 bg-soon-bg p-3">
          <p className="mb-2 text-sm font-semibold">
            Why skip {device?.nextUp?.displayName} ({device?.nextUp?.ticketNo})? <span className="font-normal text-muted-foreground">This is recorded.</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {SKIP_REASONS.map((r) => (
              <Chip key={r.value} selected={skipReason === r.value} onClick={() => setSkipReason(r.value)}>
                {r.label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {chosen.length > 0 && (
        <p className="text-center text-sm">
          Session will run until <strong className="tabular-nums">{formatClock(now + minutes * 60_000)}</strong> ({minutes} min)
        </p>
      )}
    </ResponsiveDialog>
  )
}

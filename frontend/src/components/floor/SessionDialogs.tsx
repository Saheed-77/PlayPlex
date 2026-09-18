import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Info, Square, Wrench } from 'lucide-react'
import type { EndReason, FloorDevice } from '@/types/api'
import { sessionsApi } from '@/api/sessions'
import { devicesApi } from '@/api/devices'
import { useApiMutation, usePlans } from '@/hooks/queries'
import { useIdempotencyKey } from '@/hooks/useUtils'
import { useCanAct } from '@/hooks/useConnection'
import { useUser } from '@/hooks/useAuth'
import { announce } from '@/hooks/useLive'
import { formatPaise } from '@/lib/money'
import { extensionPricePaise } from '@/lib/pricing'
import { formatClock } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Chip, Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives'
import { ResponsiveDialog } from '@/components/common/common'

const END_REASONS: { value: EndReason; label: string; adminOnly?: boolean }[] = [
  { value: 'COMPLETED', label: 'Completed — time is up' },
  { value: 'ENDED_EARLY', label: 'Ended early — student left' },
  { value: 'TECH_ISSUE', label: 'Tech issue — device misbehaved' },
  { value: 'ADMIN_OVERRIDE', label: 'Admin override', adminOnly: true },
]

/** V3 — End: COMPLETED preselected; the fault/override reasons need a note first. */
export function EndDialog({ device, forced, onClose }: { device: FloorDevice | null; forced?: boolean; onClose: () => void }) {
  const user = useUser()
  const canAct = useCanAct()
  const [reason, setReason] = useState<EndReason>('COMPLETED')
  const [note, setNote] = useState('')
  const [key, rotate] = useIdempotencyKey()

  useEffect(() => {
    if (device) {
      setReason(forced ? 'ADMIN_OVERRIDE' : 'COMPLETED')
      setNote('')
    }
  }, [device, forced])

  const end = useApiMutation(
    () =>
      forced
        ? sessionsApi.forceEnd(device!.session!.id, note.trim())
        : sessionsApi.end(device!.session!.id, { reason, note: note.trim() || null }, key),
    {
      onSuccess: () => {
        rotate()
        toast.success(`${device!.code} ended`, {
          description: reason === 'TECH_ISSUE' ? 'Players are back at the front of the queue and flagged for a refund.' : 'Device is being cleaned.',
        })
        announce(`${device!.code} ended`)
        onClose()
      },
    },
  )

  const needsNote = reason === 'TECH_ISSUE' || reason === 'ADMIN_OVERRIDE'
  const players = device?.session?.players.map((p) => p.displayName).join(' & ')

  return (
    <ResponsiveDialog
      open={device !== null}
      onOpenChange={(o) => !o && onClose()}
      title={forced ? `Force end ${device?.code}` : `End ${device?.code}?`}
      description={players ? `${players} · ${device?.session?.players[0]?.planName}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Keep playing
          </Button>
          <Button variant="destructive" disabled={!canAct || (needsNote && note.trim().length < 3)} loading={end.isPending} onClick={() => end.mutate(undefined)}>
            <Square /> End session
          </Button>
        </>
      }
    >
      {!forced && (
        <Field label="Reason" htmlFor="end-reason">
          <NativeSelect id="end-reason" value={reason} onChange={(e) => setReason(e.target.value as EndReason)}>
            {END_REASONS.filter((r) => !r.adminOnly || user.role === 'ADMIN').map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      {reason === 'TECH_ISSUE' && (
        <p className="flex gap-2 rounded-lg bg-soon-bg p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-soon" aria-hidden />
          The players go back to the front of the queue with priority, and reception sees a refund flag. If the device itself is broken, use “Report a fault” instead.
        </p>
      )}
      {needsNote && (
        <Field label={forced ? 'Why are you forcing this? (audited)' : 'What happened?'} htmlFor="end-note">
          <Textarea id="end-note" value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder="Required" />
        </Field>
      )}
    </ResponsiveDialog>
  )
}

/** V3 — Extend first, collect later: never interrupt play to chase cash. */
export function ExtendDialog({ device, minutes: initialMinutes, maxRemaining, onClose }: { device: FloorDevice | null; minutes: number; maxRemaining: number; onClose: () => void }) {
  const canAct = useCanAct()
  const plans = usePlans()
  const [minutes, setMinutes] = useState(initialMinutes)
  const [collect, setCollect] = useState(true)
  const [key, rotate] = useIdempotencyKey()

  useEffect(() => {
    if (device) {
      setMinutes(Math.min(initialMinutes, maxRemaining))
      setCollect(true)
    }
  }, [device, initialMinutes, maxRemaining])

  const s = device?.session
  const players = s?.players ?? []
  const unit = device && s && plans.data ? extensionPricePaise(plans.data, device.deviceTypeId, minutes) : null
  const payers = players.filter((p) => p.paymentStatus !== 'WAIVED')
  const total = unit === null ? null : unit * payers.length

  const extend = useApiMutation(() => sessionsApi.extend(s!.id, { minutes, collectPayment: !collect }, key), {
    onSuccess: () => {
      rotate()
      toast.success(`${device!.code} extended by ${minutes} min`, {
        description: collect ? `${payers.map((p) => p.ticketNo).join(', ')} flagged on reception’s Dues tab.` : undefined,
      })
      onClose()
    },
  })

  const newEnd = s ? +new Date(s.plannedEndAt) + minutes * 60_000 : 0

  return (
    <ResponsiveDialog
      open={device !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`Extend ${device?.code} by ${minutes} minutes`}
      description={players.map((p) => p.displayName).join(' & ')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canAct || minutes > maxRemaining} loading={extend.isPending} onClick={() => extend.mutate(undefined)}>
            Extend
          </Button>
        </>
      }
    >
      <div className="flex gap-2" role="group" aria-label="Minutes to add">
        {[15, 30].map((m) => (
          <Chip key={m} selected={minutes === m} disabled={m > maxRemaining} onClick={() => setMinutes(m)} className="flex-1">
            +{m} min
          </Chip>
        ))}
      </div>
      {maxRemaining < 30 && <p className="text-xs text-muted-foreground">This session can take {maxRemaining} more minutes at most.</p>}
      <p className="text-base">
        New end time: <strong className="tabular-nums">{formatClock(newEnd)}</strong>
      </p>
      <fieldset className="grid gap-2">
        <legend className="sr-only">Payment</legend>
        {[
          { value: false, title: 'Already paid', hint: 'Nothing to collect.' },
          {
            value: true,
            title: total === null ? 'Collect at reception' : `Collect ${formatPaise(total)} at reception`,
            hint: `Flags ${payers.map((p) => p.ticketNo).join(', ') || 'the ticket'} on reception’s Dues tab.`,
          },
        ].map((opt) => (
          <label
            key={String(opt.value)}
            className={cn('flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3', collect === opt.value ? 'border-primary bg-primary/10' : 'border-input')}
          >
            <input type="radio" name="extend-pay" className="mt-1 size-4 accent-[var(--color-primary)]" checked={collect === opt.value} onChange={() => setCollect(opt.value)} />
            <span>
              <span className="block font-semibold">{opt.title}</span>
              <span className="block text-xs text-muted-foreground">↳ {opt.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </ResponsiveDialog>
  )
}

const FAULTS = ['Charger dead', 'Screen issue', 'Controller issue', 'Network down', 'Spilled drink']

/** Report a fault: takes the device out of the pool; mid-session it ends as TECH_ISSUE. */
export function FaultDialog({ device, onClose }: { device: FloorDevice | null; onClose: () => void }) {
  const canAct = useCanAct()
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (device) setReason('')
  }, [device])

  const report = useApiMutation(() => devicesApi.setStatus(device!.id, 'OUT_OF_SERVICE', reason.trim()), {
    onSuccess: () => {
      toast.success(`${device!.code} is out of service`, { description: 'Wait estimates have been recalculated.' })
      announce(`${device!.code} out of service`)
      onClose()
    },
  })

  return (
    <ResponsiveDialog
      open={device !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`Report a fault on ${device?.code}`}
      description="Takes the device out of the pool until someone marks it fixed."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!canAct || reason.trim().length < 3} loading={report.isPending} onClick={() => report.mutate(undefined)}>
            <Wrench /> Mark out of service
          </Button>
        </>
      }
    >
      {device?.session && (
        <p className="flex gap-2 rounded-lg bg-over-bg p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-over" aria-hidden />
          This ends the session for {device.session.players.map((p) => p.displayName).join(' & ')}. They go to the front of the queue and reception is told to offer a refund.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {FAULTS.map((f) => (
          <Chip key={f} selected={reason === f} onClick={() => setReason(f)}>
            {f}
          </Chip>
        ))}
      </div>
      <Field label="What's wrong?" htmlFor="fault-reason">
        <Input id="fault-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Charger dead" />
      </Field>
    </ResponsiveDialog>
  )
}

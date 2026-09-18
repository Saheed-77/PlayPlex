import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowUp, Banknote, HandCoins, Pencil, RotateCcw, Smartphone, Undo2, X } from 'lucide-react'
import type { PaymentMethod, Ticket } from '@/types/api'
import { ticketsApi } from '@/api/tickets'
import { qk, useApiMutation, useFloor } from '@/hooks/queries'
import { useIdempotencyKey } from '@/hooks/useUtils'
import { useUser } from '@/hooks/useAuth'
import { useCanAct } from '@/hooks/useConnection'
import { formatPaise } from '@/lib/money'
import { formatClock, formatDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge, Chip, Field, Input, NativeSelect, Separator, Textarea } from '@/components/ui/primitives'
import { LoadingRows, PaymentStatusPill, ResponsiveDialog, Stat, TicketStatusPill } from '@/components/common/common'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/overlays'

export type TicketAction = 'collect' | 'refund' | 'cancel' | 'edit' | 'requeue' | 'priority'

const TICKET_KEYS = [qk.floor, ['tickets'], ['queue']]

export function availableActions(t: Ticket, isAdmin: boolean): TicketAction[] {
  const out: TicketAction[] = []
  if (t.paymentStatus === 'PAYMENT_DUE') out.push('collect')
  if (t.paymentStatus === 'REFUND_DUE') out.push('refund')
  if (t.status === 'QUEUED') out.push('edit')
  if (t.status === 'NO_SHOW') out.push('requeue')
  if (t.status === 'QUEUED' || t.status === 'NO_SHOW' || (isAdmin && t.status === 'ASSIGNED')) out.push('cancel')
  if (isAdmin && t.status === 'QUEUED') out.push('priority')
  return out
}

export const ACTION_META: Record<TicketAction, { label: string; icon: typeof X }> = {
  collect: { label: 'Collect due', icon: HandCoins },
  refund: { label: 'Refund', icon: Undo2 },
  edit: { label: 'Edit preference', icon: Pencil },
  requeue: { label: 'Put back in queue', icon: RotateCcw },
  cancel: { label: 'Cancel ticket', icon: X },
  priority: { label: 'Priority…', icon: ArrowUp },
}

function MethodChips({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <div className="flex gap-2" role="group" aria-label="Payment method">
      <Chip selected={value === 'CASH'} onClick={() => onChange('CASH')} className="flex-1">
        <Banknote /> Cash
      </Chip>
      <Chip selected={value === 'UPI'} onClick={() => onChange('UPI')} className="flex-1">
        <Smartphone /> UPI
      </Chip>
    </div>
  )
}

/** One entry point for every ticket action dialog. */
export function TicketActionDialog({ ticket, action, onClose }: { ticket: Ticket | null; action: TicketAction | null; onClose: () => void }) {
  const open = ticket !== null && action !== null
  const canAct = useCanAct()
  const floor = useFloor()
  const [key, rotate] = useIdempotencyKey()
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [refund, setRefund] = useState(true)
  const [pref, setPref] = useState<string>('')
  const [priority, setPriority] = useState(1)

  useEffect(() => {
    if (!ticket) return
    setMethod('CASH')
    setRef('')
    setNote('')
    setRefund(ticket.balancePaise > 0)
    setPref(ticket.preferredDeviceType ? String(ticket.preferredDeviceType.id) : '')
    setPriority(Math.max(1, ticket.priority))
  }, [ticket, action])

  const done = (msg: string) => () => {
    rotate()
    toast.success(msg)
    onClose()
  }

  const collect = useApiMutation(
    () => ticketsApi.settle(ticket!.id, { kind: 'EXTENSION', method, amountPaise: ticket!.amountDuePaise, referenceNo: ref || undefined }, key),
    { invalidate: TICKET_KEYS, onSuccess: done(`Collected ${formatPaise(ticket?.amountDuePaise ?? 0)} for ${ticket?.ticketNo}`) },
  )
  const doRefund = useApiMutation(
    () => ticketsApi.settle(ticket!.id, { kind: 'REFUND', method, amountPaise: ticket!.amountDuePaise || ticket!.balancePaise, note, referenceNo: ref || undefined }, key),
    { invalidate: TICKET_KEYS, onSuccess: done(`Refunded ${ticket?.ticketNo}`) },
  )
  const cancel = useApiMutation(() => ticketsApi.cancel(ticket!.id, { reason: note, refund, method }), {
    invalidate: TICKET_KEYS,
    onSuccess: done(`${ticket?.ticketNo} cancelled${refund ? ' and refunded' : ''}`),
  })
  const edit = useApiMutation(() => ticketsApi.update(ticket!.id, { preferredDeviceTypeId: pref ? Number(pref) : null }), {
    invalidate: TICKET_KEYS,
    onSuccess: done(`${ticket?.ticketNo} preference updated`),
  })
  const requeue = useApiMutation(() => ticketsApi.requeue(ticket!.id), {
    invalidate: TICKET_KEYS,
    onSuccess: done(`${ticket?.ticketNo} is back in the queue in their original place`),
  })
  const bump = useApiMutation(() => ticketsApi.setPriority(ticket!.id, priority, note), {
    invalidate: TICKET_KEYS,
    onSuccess: done(`${ticket?.ticketNo} priority set to ${priority}`),
  })

  if (!ticket || !action) return <ResponsiveDialog open={false} onOpenChange={onClose} title="" />
  const who = `${ticket.ticketNo} · ${ticket.student.fullName}`
  const cancelBtn = (
    <Button variant="outline" onClick={onClose}>
      Back
    </Button>
  )

  switch (action) {
    case 'collect':
      return (
        <ResponsiveDialog
          open={open}
          onOpenChange={(o) => !o && onClose()}
          title={`Collect ${formatPaise(ticket.amountDuePaise)}`}
          description={`${who} · extension played, not yet paid`}
          footer={
            <>
              {cancelBtn}
              <Button disabled={!canAct} loading={collect.isPending} onClick={() => collect.mutate(undefined)}>
                <HandCoins /> Record {formatPaise(ticket.amountDuePaise)} {method === 'UPI' ? 'UPI' : 'cash'}
              </Button>
            </>
          }
        >
          <MethodChips value={method} onChange={setMethod} />
          {method === 'UPI' && (
            <Field label="UPI reference (optional)" htmlFor="c-ref">
              <Input id="c-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="T2409140912" />
            </Field>
          )}
        </ResponsiveDialog>
      )
    case 'refund': {
      const amount = ticket.amountDuePaise || ticket.balancePaise
      return (
        <ResponsiveDialog
          open={open}
          onOpenChange={(o) => !o && onClose()}
          title={`Refund ${formatPaise(amount)}`}
          description={`${who}. Refunding gives up their reissued turn in the queue.`}
          footer={
            <>
              {cancelBtn}
              <Button variant="destructive" disabled={!canAct || note.trim().length < 3} loading={doRefund.isPending} onClick={() => doRefund.mutate(undefined)}>
                <Undo2 /> Refund {formatPaise(amount)}
              </Button>
            </>
          }
        >
          <MethodChips value={method} onChange={setMethod} />
          <Field label="Note (required)" htmlFor="r-note">
            <Textarea id="r-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. PC crashed, student chose a refund" autoFocus />
          </Field>
        </ResponsiveDialog>
      )
    }
    case 'cancel':
      return (
        <ResponsiveDialog
          open={open}
          onOpenChange={(o) => !o && onClose()}
          title={`Cancel ${ticket.ticketNo}?`}
          description={ticket.status === 'ASSIGNED' ? `${who}. This also ends their running session (admin override).` : who}
          footer={
            <>
              {cancelBtn}
              <Button variant="destructive" disabled={!canAct || note.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>
                <X /> Cancel ticket{refund && ticket.balancePaise > 0 ? ` + refund ${formatPaise(ticket.balancePaise)}` : ''}
              </Button>
            </>
          }
        >
          <Field label="Reason" htmlFor="x-note">
            <Textarea id="x-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Had to leave for a lab" autoFocus />
          </Field>
          {ticket.balancePaise > 0 ? (
            <>
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
                Refund {formatPaise(ticket.balancePaise)} to the student
              </label>
              {refund && <MethodChips value={method} onChange={setMethod} />}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing was paid on this ticket, so there’s nothing to refund.</p>
          )}
        </ResponsiveDialog>
      )
    case 'edit':
      return (
        <ResponsiveDialog
          open={open}
          onOpenChange={(o) => !o && onClose()}
          title="Change device preference"
          description={`${who}. They keep their place in line. A fare difference is a new sale.`}
          footer={
            <>
              {cancelBtn}
              <Button disabled={!canAct} loading={edit.isPending} onClick={() => edit.mutate(undefined)}>
                Save
              </Button>
            </>
          }
        >
          <Field label="Wants to play on" htmlFor="e-pref">
            <NativeSelect id="e-pref" value={pref} onChange={(e) => setPref(e.target.value)}>
              <option value="">Any device (fastest)</option>
              {floor.data?.byDeviceType.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · wait {t.estimatedWaitMinutes === 0 ? 'now' : `~${t.estimatedWaitMinutes} min`}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </ResponsiveDialog>
      )
    case 'requeue':
      return (
        <ResponsiveDialog
          open={open}
          onOpenChange={(o) => !o && onClose()}
          title={`Put ${ticket.ticketNo} back in the queue?`}
          description={`${who} was a no-show. They keep their original queue time (${formatClock(ticket.queuedAt)}), so they land near the front.`}
          footer={
            <>
              {cancelBtn}
              <Button disabled={!canAct} loading={requeue.isPending} onClick={() => requeue.mutate(undefined)}>
                <RotateCcw /> Requeue
              </Button>
            </>
          }
        />
      )
    case 'priority':
      return (
        <ResponsiveDialog
          open={open}
          onOpenChange={(o) => !o && onClose()}
          title={`Priority for ${ticket.ticketNo}`}
          description="Higher jumps the queue. Every change is written to the audit log with your reason."
          footer={
            <>
              {cancelBtn}
              <Button disabled={!canAct || note.trim().length < 3} loading={bump.isPending} onClick={() => bump.mutate(undefined)}>
                <ArrowUp /> Set priority {priority}
              </Button>
            </>
          }
        >
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((p) => (
              <Chip key={p} selected={priority === p} onClick={() => setPriority(p)} className="flex-1">
                {p === 0 ? 'Normal' : p}
              </Chip>
            ))}
          </div>
          <Field label="Reason (audited)" htmlFor="p-note">
            <Textarea id="p-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Faculty guest with a 10-minute window" autoFocus />
          </Field>
        </ResponsiveDialog>
      )
  }
}

/** Row click → full detail including the payment ledger (docs/05 R4). */
export function TicketDrawer({ ticketId, onClose, onAction }: { ticketId: number | null; onClose: () => void; onAction: (t: Ticket, a: TicketAction) => void }) {
  const user = useUser()
  const detail = useQuery({ queryKey: qk.ticket(ticketId ?? 0), queryFn: () => ticketsApi.get(ticketId!), enabled: ticketId !== null })
  const t = detail.data

  return (
    <Dialog open={ticketId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="left-auto right-0 top-0 h-dvh max-h-dvh w-full max-w-md translate-x-0 translate-y-0 rounded-none sm:rounded-l-2xl">
        <div className="border-b px-5 py-4 pr-14">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <span className="font-mono">{t?.ticketNo ?? '…'}</span>
            {t && <TicketStatusPill status={t.status} />}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t ? `${t.student.fullName} · ${t.student.phone}` : 'Loading ticket'}</DialogDescription>
        </div>
        <div className="grid flex-1 content-start gap-5 overflow-y-auto px-5 py-4">
          {!t ? (
            <LoadingRows rows={4} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Plan" value={`${t.plan.name} · ${t.plan.durationMinutes}m`} />
                <Stat label="Price (at sale)" value={formatPaise(t.plan.pricePaise)} />
                <Stat label="Wants" value={t.preferredDeviceType?.name ?? 'Any device'} />
                <Stat label="Queued" value={formatClock(t.queuedAt)} />
                {t.queuePosition !== null && <Stat label="Position" value={`#${t.queuePosition} · ~${t.estimatedWaitMinutes ?? '?'} min`} />}
                {t.deviceCode && <Stat label="Playing on" value={t.deviceCode} />}
                {t.student.rollNo && <Stat label="Roll no." value={t.student.rollNo} />}
                <Stat label="Registered by" value={t.registeredByName} />
                {t.priority > 0 && <Stat label="Priority" value={t.priority} />}
                {t.noShowCount > 0 && <Stat label="No-shows" value={t.noShowCount} />}
              </div>
              {t.notes && <p className="rounded-lg bg-muted p-3 text-sm">{t.notes}</p>}

              <section>
                <h3 className="mb-2 flex items-center justify-between text-sm font-bold">
                  Payment ledger <PaymentStatusPill status={t.paymentStatus} />
                </h3>
                <ul className="grid gap-1 text-sm">
                  {t.payments.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3 rounded-md bg-muted/60 px-3 py-2">
                      <span>
                        <span className="font-semibold">{p.kind === 'INITIAL' ? 'Ticket' : p.kind === 'EXTENSION' ? 'Extension' : 'Refund'}</span>{' '}
                        <Badge>{p.method}</Badge>
                        <span className="block text-xs text-muted-foreground">
                          {formatDateTime(p.collectedAt)} · {p.collectedByName}
                          {p.referenceNo && ` · ${p.referenceNo}`}
                          {p.note && ` · ${p.note}`}
                        </span>
                      </span>
                      <span className={cn('font-semibold tabular-nums', p.amountPaise < 0 && 'text-over')}>{formatPaise(p.amountPaise)}</span>
                    </li>
                  ))}
                </ul>
                <Separator className="my-2" />
                <p className="flex justify-between text-sm font-bold">
                  <span>Balance</span>
                  <span className="tabular-nums">{formatPaise(t.balancePaise)}</span>
                </p>
                {t.amountDuePaise > 0 && (
                  <p className="mt-1 flex justify-between text-sm font-semibold text-over">
                    <span>{t.paymentStatus === 'REFUND_DUE' ? 'To refund' : 'Still owed'}</span>
                    <span className="tabular-nums">{formatPaise(t.amountDuePaise)}</span>
                  </p>
                )}
              </section>

              {t.sessions.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-bold">Sessions</h3>
                  <ul className="grid gap-1 text-sm">
                    {t.sessions.map((s) => (
                      <li key={s.id} className="flex justify-between rounded-md bg-muted/60 px-3 py-2">
                        <span>
                          <strong>{s.deviceCode}</strong> · {formatClock(s.startedAt)}–{formatClock(s.endedAt ?? s.plannedEndAt)}
                          {s.extensionMinutesTotal > 0 && ` · +${s.extensionMinutesTotal}m`}
                        </span>
                        <span className="text-xs text-muted-foreground">{s.endedAt ? (s.endReason ?? '').replace('_', ' ').toLowerCase() : 'running'}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
        {t && availableActions(t, user.role === 'ADMIN').length > 0 && (
          <div className="flex flex-wrap gap-2 border-t px-5 py-3">
            {availableActions(t, user.role === 'ADMIN').map((a) => {
              const M = ACTION_META[a]
              return (
                <Button key={a} variant={a === 'collect' ? 'default' : a === 'cancel' || a === 'refund' ? 'outline' : 'secondary'} size="sm" onClick={() => onAction(t, a)}>
                  <M.icon /> {M.label}
                </Button>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

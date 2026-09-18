import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, GripVertical, KeyRound, Pencil, Plus, RotateCcw, Save, TriangleAlert, UserCheck, UserPlus, UserX } from 'lucide-react'
import type { AdminDevice, DeviceType, EventSettings, Plan, Role, StaffUser } from '@/types/api'
import { devicesApi, type DeviceInput, type DeviceTypeInput } from '@/api/devices'
import { plansApi, settingsApi, staffApi, type PlanInput } from '@/api/admin'
import { ApiError, friendlyMessage } from '@/api/errors'
import { qk, useApiMutation } from '@/hooks/queries'
import { useUser } from '@/hooks/useAuth'
import { useServerNow } from '@/hooks/useServerNow'
import { DEVICE_ICONS, DeviceTypeIcon } from '@/lib/icons'
import { formatPaise, parseRupees } from '@/lib/money'
import { ROLE_LABEL } from '@/lib/roles'
import { formatClock, formatDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { deriveState, type VisualState } from '@/lib/deviceState'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardContent, CardHeader, CardTitle, Chip, Field, Input, NativeSelect, TBody, TD, TH, THead, TR, Table, type BadgeTone } from '@/components/ui/primitives'
import { Switch } from '@/components/ui/overlays'
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, PageHeader, ResponsiveDialog } from '@/components/common/common'
import { STATE_STYLE } from '@/components/floor/DeviceCard'

const errorsOf = (err: unknown) => (err instanceof ApiError ? err.fieldErrors : {})

// ── A2 Devices ───────────────────────────────────────────────────────────────
const STATE_TONE: Record<VisualState, BadgeTone> = { OVERDUE: 'over', ENDING_SOON: 'soon', FREE: 'free', RUNNING: 'run', CLEANING: 'clean', OUT: 'out' }

export function DevicesPage() {
  const now = useServerNow()
  const devices = useQuery({ queryKey: qk.adminDevices, queryFn: devicesApi.adminList })
  const types = useQuery({ queryKey: qk.deviceTypes, queryFn: devicesApi.types })
  const [adding, setAdding] = useState<number | null | 'pick'>(null)
  const [editing, setEditing] = useState<AdminDevice | null>(null)
  const [typeForm, setTypeForm] = useState<DeviceType | 'new' | null>(null)
  const [removing, setRemoving] = useState<AdminDevice | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const invalidate = [qk.adminDevices, qk.floor, qk.deviceTypes]

  const remove = useApiMutation((d: AdminDevice) => devicesApi.remove(d.id), {
    invalidate,
    onSuccess: (_, d) => {
      toast.success(`${d.code} removed from the floor`, { description: 'Its history stays in the reports.' })
      setRemoving(null)
    },
  })
  const restore = useApiMutation((d: AdminDevice) => devicesApi.update(d.id, { active: true }), {
    invalidate,
    onSuccess: (d) => toast.success(`${d.code} is back on the floor`),
  })

  if (devices.isPending || types.isPending) return <LoadingRows rows={8} />
  if (devices.isError) return <ErrorState error={devices.error} onRetry={() => devices.refetch()} />
  const all = devices.data
  const list = all.filter((d) => showInactive || d.active)

  return (
    <>
      <PageHeader
        title="Devices"
        description="Adding a second PS5 mid-event is a 10-second job — every board picks it up live."
        actions={
          <>
            <Button variant="outline" onClick={() => setTypeForm('new')}>
              <Plus /> Add device type
            </Button>
            <Button onClick={() => setAdding('pick')}>
              <Plus /> Add device
            </Button>
          </>
        }
      />
      <label className="mb-3 flex items-center gap-2 text-sm">
        <Switch checked={showInactive} onCheckedChange={setShowInactive} /> Show removed devices
      </label>
      <div className="grid gap-4">
        {(types.data ?? []).map((t) => {
          const rows = list.filter((d) => d.deviceTypeId === t.id)
          return (
            <Card key={t.id}>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <DeviceTypeIcon icon={t.icon} className="size-5 text-muted-foreground" /> {t.name} <Badge>{t.code}</Badge>
                  <span className="text-sm font-normal text-muted-foreground">
                    {rows.filter((r) => r.active).length} active · {t.defaultCapacity} seat{t.defaultCapacity > 1 ? 's' : ''} by default
                  </span>
                </CardTitle>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setTypeForm(t)}>
                    <Pencil /> Edit type
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setAdding(t.id)}>
                    <Plus /> Add {t.code}
                  </Button>
                </div>
              </CardHeader>
              {rows.length === 0 ? (
                <CardContent>
                  <EmptyState title={`No ${t.name} units yet`} action={<Button size="sm" onClick={() => setAdding(t.id)}>Add the first one</Button>} />
                </CardContent>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Code</TH>
                      <TH>Label</TH>
                      <TH>Seats</TH>
                      <TH>Status</TH>
                      <TH>Current session</TH>
                      <TH>Uptime today</TH>
                      <TH>Sessions</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((d) => {
                      const state = deriveState({ status: d.status, session: d.currentSession }, now, 5 * 60_000).state
                      const S = STATE_STYLE[state]
                      return (
                        <TR key={d.id} className={cn(!d.active && 'opacity-50')}>
                          <TD className="font-mono font-semibold">{d.code}</TD>
                          <TD>
                            {d.label}
                            {d.locationNote && <span className="block text-xs text-muted-foreground">{d.locationNote}</span>}
                          </TD>
                          <TD className="tabular-nums">{d.capacity}</TD>
                          <TD>
                            {d.active ? (
                              <Badge tone={STATE_TONE[state]}>
                                <S.icon /> {S.label}
                              </Badge>
                            ) : (
                              <Badge>Removed</Badge>
                            )}
                            {d.statusReason && <span className="block text-xs text-muted-foreground">{d.statusReason}</span>}
                          </TD>
                          <TD className="text-sm">{d.currentSession ? `${d.currentSession.ticketNos.join(', ')} · until ${formatClock(d.currentSession.plannedEndAt)}` : '—'}</TD>
                          <TD className="tabular-nums">{d.uptimePctToday}%</TD>
                          <TD className="tabular-nums">{d.sessionsToday}</TD>
                          <TD className="whitespace-nowrap text-right">
                            {d.active ? (
                              <>
                                <Button variant="ghost" size="sm" onClick={() => setEditing(d)}>
                                  <Pencil /> Edit
                                </Button>
                                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRemoving(d)}>
                                  Remove
                                </Button>
                              </>
                            ) : (
                              <Button variant="ghost" size="sm" loading={restore.isPending} onClick={() => restore.mutate(d)}>
                                <RotateCcw /> Restore
                              </Button>
                            )}
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
            </Card>
          )
        })}
      </div>

      <DeviceForm open={adding !== null || editing !== null} types={types.data ?? []} initialType={typeof adding === 'number' ? adding : null} device={editing} onClose={() => (setAdding(null), setEditing(null))} />
      <DeviceTypeForm type={typeForm} onClose={() => setTypeForm(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.code} from the floor?`}
        description={
          removing?.status === 'IN_USE'
            ? `${removing.code} has a session running. End it first — the server will refuse otherwise.`
            : 'It disappears from every board. This is a soft delete: reports still show its history, and you can restore it.'
        }
        confirmLabel="Remove device"
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </>
  )
}

function DeviceForm({ open, types, initialType, device, onClose }: { open: boolean; types: DeviceType[]; initialType: number | null; device: AdminDevice | null; onClose: () => void }) {
  const [form, setForm] = useState<DeviceInput>({ deviceTypeId: 0, code: '', label: '', locationNote: '', capacity: 1 })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const qc = useQueryClient()

  useEffect(() => {
    if (!open) return
    setErrors({})
    if (device) setForm({ deviceTypeId: device.deviceTypeId, code: device.code, label: device.label, locationNote: device.locationNote, capacity: device.capacity })
    else {
      const t = types.find((x) => x.id === initialType) ?? types[0]
      setForm({ deviceTypeId: t?.id ?? 0, code: '', label: '', locationNote: '', capacity: t?.defaultCapacity ?? 1 })
    }
  }, [open, device, initialType, types])

  // Auto-suggest the next code in sequence (LAP-11).
  useEffect(() => {
    if (!open || device || !form.deviceTypeId) return
    devicesApi.suggestCode(form.deviceTypeId).then((r) => setForm((f) => ({ ...f, code: r.code })), () => {})
  }, [open, device, form.deviceTypeId])

  const save = useApiMutation(() => (device ? devicesApi.update(device.id, { label: form.label, locationNote: form.locationNote, capacity: form.capacity }) : devicesApi.create(form)), {
    invalidate: [qk.adminDevices, qk.floor],
    onSuccess: (d) => {
      toast.success(device ? `${d.code} updated` : `${d.code} added — it's live on every board`)
      qc.invalidateQueries({ queryKey: ['queue'] })
      onClose()
    },
    onError: (err) => {
      const e = errorsOf(err)
      setErrors(e)
      return Object.keys(e).length > 0
    },
  })

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={device ? `Edit ${device.code}` : 'Add a device'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            <Save /> {device ? 'Save' : 'Add device'}
          </Button>
        </>
      }
    >
      {!device && (
        <Field label="Type" htmlFor="d-type" error={errors.deviceTypeId}>
          <NativeSelect
            id="d-type"
            value={form.deviceTypeId}
            onChange={(e) => {
              const t = types.find((x) => x.id === Number(e.target.value))
              setForm((f) => ({ ...f, deviceTypeId: Number(e.target.value), capacity: t?.defaultCapacity ?? f.capacity }))
            }}
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code (on the sticker)" htmlFor="d-code" error={errors.code} hint={device ? 'Codes never change' : 'Suggested from the sequence'}>
          <Input id="d-code" value={form.code} disabled={!!device} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} aria-invalid={!!errors.code} />
        </Field>
        <Field label="Seats" htmlFor="d-cap" error={errors.capacity}>
          <Input id="d-cap" type="number" min={1} max={8} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="Label" htmlFor="d-label">
        <Input id="d-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Laptop bay 11" />
      </Field>
      <Field label="Where is it?" htmlFor="d-loc" hint="Helps a new volunteer find it">
        <Input id="d-loc" value={form.locationNote} onChange={(e) => setForm({ ...form, locationNote: e.target.value })} placeholder="Back row, near the window" />
      </Field>
    </ResponsiveDialog>
  )
}

function DeviceTypeForm({ type, onClose }: { type: DeviceType | 'new' | null; onClose: () => void }) {
  const editing = type !== null && type !== 'new' ? type : null
  const [form, setForm] = useState<DeviceTypeInput>({ code: '', name: '', icon: 'glasses', defaultCapacity: 1 })
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (type === null) return
    setErrors({})
    setForm(editing ? { code: editing.code, name: editing.name, icon: editing.icon, defaultCapacity: editing.defaultCapacity } : { code: '', name: '', icon: 'glasses', defaultCapacity: 1 })
  }, [type, editing])

  const save = useApiMutation(() => (editing ? devicesApi.updateType(editing.id, { name: form.name, icon: form.icon, defaultCapacity: form.defaultCapacity }) : devicesApi.createType(form)), {
    invalidate: [qk.deviceTypes, qk.adminDevices, qk.floor],
    onSuccess: (t) => {
      toast.success(editing ? `${t.name} updated` : `${t.name} added`, { description: editing ? undefined : 'Now add its units, and a plan if it needs its own price.' })
      onClose()
    },
    onError: (err) => {
      const e = errorsOf(err)
      setErrors(e)
      return Object.keys(e).length > 0
    },
  })

  return (
    <ResponsiveDialog
      open={type !== null}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? `Edit ${editing.name}` : 'Add a device type'}
      description={editing ? undefined : 'A whole new category: VR, board games, an arcade cabinet…'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            <Save /> Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <Field label="Code" htmlFor="t-code" error={errors.code}>
          <Input id="t-code" value={form.code} disabled={!!editing} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="VR" />
        </Field>
        <Field label="Name" htmlFor="t-name" error={errors.name}>
          <Input id="t-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VR Headset" />
        </Field>
      </div>
      <Field label="Default seats per unit" htmlFor="t-cap" error={errors.defaultCapacity}>
        <Input id="t-cap" type="number" min={1} max={8} value={form.defaultCapacity} onChange={(e) => setForm({ ...form, defaultCapacity: Number(e.target.value) })} />
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Icon</legend>
        <div className="flex flex-wrap gap-2">
          {Object.keys(DEVICE_ICONS).map((icon) => (
            <Chip key={icon} selected={form.icon === icon} onClick={() => setForm({ ...form, icon })} aria-label={icon}>
              <DeviceTypeIcon icon={icon} className="size-5" />
            </Chip>
          ))}
        </div>
      </fieldset>
    </ResponsiveDialog>
  )
}

// ── A3 Plans & pricing ───────────────────────────────────────────────────────
function SortablePlan({ plan, types, onEdit, onToggle }: { plan: Plan; types: DeviceType[]; onEdit: () => void; onToggle: (active: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: plan.id })
  const only = types.filter((t) => plan.deviceTypeIds.includes(t.id))
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && 'z-10 opacity-80')}>
      <Card className={cn('flex h-full flex-col p-4', !plan.active && 'opacity-60')}>
        <div className="mb-2 flex items-start gap-2">
          <button type="button" className="-ml-1 grid size-9 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing" aria-label={`Reorder ${plan.name}`} {...attributes} {...listeners}>
            <GripVertical className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-bold">{plan.name}</p>
            <p className="text-sm text-muted-foreground">
              {plan.durationMinutes} min{plan.seatsPerTicket > 1 && ` · ${plan.seatsPerTicket} players`}
            </p>
          </div>
          <Switch checked={plan.active} onCheckedChange={onToggle} aria-label={plan.active ? `Archive ${plan.name}` : `Activate ${plan.name}`} />
        </div>
        <p className="text-3xl font-black tabular-nums">{formatPaise(plan.pricePaise)}</p>
        <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.description}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {only.length ? only.map((t) => <Badge key={t.id} tone="soon">{t.code} only</Badge>) : <Badge>All devices</Badge>}
          {!plan.active && <Badge tone="out">Archived</Badge>}
          <Badge tone="primary">{plan.ticketsSold ?? 0} sold at this price</Badge>
        </div>
        <Button variant="outline" size="sm" className="mt-3 self-start" onClick={onEdit}>
          <Pencil /> Edit
        </Button>
      </Card>
    </div>
  )
}

export function PlansPage() {
  const qc = useQueryClient()
  const plans = useQuery({ queryKey: qk.adminPlans, queryFn: plansApi.all })
  const types = useQuery({ queryKey: qk.deviceTypes, queryFn: devicesApi.types })
  const [editing, setEditing] = useState<Plan | 'new' | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const invalidate = [qk.adminPlans, qk.plans]
  const reorder = useApiMutation((ids: number[]) => plansApi.reorder(ids), { invalidate })
  const toggle = useApiMutation(({ id, active }: { id: number; active: boolean }) => plansApi.update(id, { active }), {
    invalidate,
    onSuccess: (p) => toast.success(p.active ? `${p.name} is on sale` : `${p.name} archived`, { description: p.active ? undefined : 'Tickets already sold keep working.' }),
  })

  const onDragEnd = (e: DragEndEvent) => {
    if (!plans.data || !e.over || e.active.id === e.over.id) return
    const ids = plans.data.map((p) => p.id)
    const next = arrayMove(plans.data, ids.indexOf(Number(e.active.id)), ids.indexOf(Number(e.over.id)))
    qc.setQueryData(qk.adminPlans, next)
    reorder.mutate(next.map((p) => p.id))
  }

  return (
    <>
      <PageHeader
        title="Plans & pricing"
        description="Drag to set the order reception sees. Price changes apply to new sales only."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New plan
          </Button>
        }
      />
      {plans.isPending ? (
        <LoadingRows />
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={plans.data.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {plans.data.map((p) => (
                <SortablePlan key={p.id} plan={p} types={types.data ?? []} onEdit={() => setEditing(p)} onToggle={(active) => toggle.mutate({ id: p.id, active })} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <PlanForm plan={editing} types={types.data ?? []} onClose={() => setEditing(null)} />
    </>
  )
}

function PlanForm({ plan, types, onClose }: { plan: Plan | 'new' | null; types: DeviceType[]; onClose: () => void }) {
  const existing = plan !== null && plan !== 'new' ? plan : null
  const [form, setForm] = useState({ name: '', durationMinutes: '30', price: '', description: '', deviceTypeIds: [] as number[], seatsPerTicket: 1 })
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (plan === null) return
    setErrors({})
    setForm(
      existing
        ? { name: existing.name, durationMinutes: String(existing.durationMinutes), price: String(existing.pricePaise / 100), description: existing.description, deviceTypeIds: existing.deviceTypeIds, seatsPerTicket: existing.seatsPerTicket }
        : { name: '', durationMinutes: '30', price: '', description: '', deviceTypeIds: [], seatsPerTicket: 1 },
    )
  }, [plan, existing])

  const pricePaise = parseRupees(form.price)
  const priceChanged = existing && pricePaise !== null && pricePaise !== existing.pricePaise

  const save = useApiMutation(
    () => {
      const body: PlanInput = {
        name: form.name,
        durationMinutes: Number(form.durationMinutes),
        pricePaise: pricePaise ?? -1,
        description: form.description,
        deviceTypeIds: form.deviceTypeIds,
        seatsPerTicket: form.seatsPerTicket,
        active: existing?.active ?? true,
      }
      return existing ? plansApi.update(existing.id, body) : plansApi.create(body)
    },
    {
      invalidate: [qk.adminPlans, qk.plans],
      onSuccess: (p) => {
        toast.success(existing ? `${p.name} saved` : `${p.name} created`)
        onClose()
      },
      onError: (err) => {
        const e = errorsOf(err)
        setErrors(e)
        return Object.keys(e).length > 0
      },
    },
  )

  return (
    <ResponsiveDialog
      open={plan !== null}
      onOpenChange={(o) => !o && onClose()}
      title={existing ? `Edit ${existing.name}` : 'New plan'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            <Save /> Save plan
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="p-name" error={errors.name}>
        <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Happy Hour" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Minutes" htmlFor="p-dur" error={errors.durationMinutes}>
          <Input id="p-dur" type="number" min={5} step={5} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
        </Field>
        <Field label="Price (₹)" htmlFor="p-price" error={errors.pricePaise ?? (form.price && pricePaise === null ? 'Enter an amount like 50' : undefined)}>
          <Input id="p-price" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="50" />
        </Field>
      </div>
      {priceChanged && (
        <p role="note" className="flex gap-2 rounded-lg border border-soon/50 bg-soon-bg p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-soon" aria-hidden />
          <span>
            Changing this price affects <strong>new</strong> registrations only. The {existing.ticketsSold ?? 0} tickets already sold at {formatPaise(existing.pricePaise)} keep that price in all reports.
          </span>
        </p>
      )}
      <Field label="Description" htmlFor="p-desc" hint="Shown to reception under the price">
        <Input id="p-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Applies to</legend>
        <div className="flex flex-wrap gap-2">
          <Chip selected={form.deviceTypeIds.length === 0} onClick={() => setForm({ ...form, deviceTypeIds: [] })}>
            All devices
          </Chip>
          {types.map((t) => (
            <Chip
              key={t.id}
              selected={form.deviceTypeIds.includes(t.id)}
              onClick={() => setForm({ ...form, deviceTypeIds: form.deviceTypeIds.includes(t.id) ? form.deviceTypeIds.filter((x) => x !== t.id) : [...form.deviceTypeIds, t.id] })}
            >
              <DeviceTypeIcon icon={t.icon} /> {t.code}
            </Chip>
          ))}
        </div>
      </fieldset>
      <Field label="Players per ticket" htmlFor="p-seats" error={errors.seatsPerTicket} hint="2 for a couch co-op plan like Console Duo">
        <NativeSelect id="p-seats" value={form.seatsPerTicket} onChange={(e) => setForm({ ...form, seatsPerTicket: Number(e.target.value) })}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </NativeSelect>
      </Field>
    </ResponsiveDialog>
  )
}

// ── A4 Staff ─────────────────────────────────────────────────────────────────
const ROLE_TONE: Record<Role, BadgeTone> = { ADMIN: 'over', RECEPTION: 'clean', VOLUNTEER: 'free' }

export function StaffPage() {
  const me = useUser()
  const staff = useQuery({ queryKey: qk.staff, queryFn: staffApi.list })
  const [creating, setCreating] = useState(false)
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null)
  const [confirm, setConfirm] = useState<{ user: StaffUser; kind: 'deactivate' | 'reset' } | null>(null)
  const invalidate = [qk.staff]

  const update = useApiMutation(({ id, body }: { id: number; body: { role?: Role; active?: boolean } }) => staffApi.update(id, body), {
    invalidate,
    onSuccess: (u) => {
      toast.success(`${u.fullName} updated`)
      setConfirm(null)
    },
  })
  const reset = useApiMutation((u: StaffUser) => staffApi.resetPassword(u.id), {
    invalidate,
    onSuccess: (r, u) => {
      setConfirm(null)
      setTemp({ username: u.username, password: r.temporaryPassword })
    },
  })

  return (
    <>
      <PageHeader
        title="Staff"
        description="Accounts are deactivated, never deleted — the audit log points at them."
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus /> Add staff
          </Button>
        }
      />
      <Card>
        {staff.isPending ? (
          <LoadingRows className="p-4" />
        ) : staff.isError ? (
          <ErrorState className="m-4" error={staff.error} onRetry={() => staff.refetch()} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Username</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH>Last sign-in</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {staff.data.map((u) => {
                const self = u.id === me.id
                return (
                  <TR key={u.id} className={cn(!u.active && 'opacity-55')}>
                    <TD className="font-semibold">
                      {u.fullName} {self && <Badge>you</Badge>}
                    </TD>
                    <TD className="font-mono text-sm">{u.username}</TD>
                    <TD>
                      {self ? (
                        <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                      ) : (
                        <NativeSelect aria-label={`Role for ${u.fullName}`} className="h-9 w-36" value={u.role} onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value as Role } })}>
                          {(['VOLUNTEER', 'RECEPTION', 'ADMIN'] as Role[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </NativeSelect>
                      )}
                    </TD>
                    <TD>
                      {!u.active ? <Badge tone="out">Deactivated</Badge> : u.mustChangePassword ? <Badge tone="soon">Temp password</Badge> : <Badge tone="free">Active</Badge>}
                    </TD>
                    <TD className="text-sm tabular-nums">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</TD>
                    <TD className="whitespace-nowrap text-right">
                      <Button variant="ghost" size="sm" onClick={() => setConfirm({ user: u, kind: 'reset' })}>
                        <KeyRound /> Reset password
                      </Button>
                      {!self &&
                        (u.active ? (
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirm({ user: u, kind: 'deactivate' })}>
                            <UserX /> Deactivate
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: u.id, body: { active: true } })}>
                            <UserCheck /> Reactivate
                          </Button>
                        ))}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <StaffForm open={creating} onClose={() => setCreating(false)} onCreated={(username, password) => setTemp({ username, password })} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === 'reset' ? `Reset ${confirm.user.fullName}’s password?` : `Deactivate ${confirm?.user.fullName}?`}
        description={confirm?.kind === 'reset' ? 'You’ll get a one-time password to read out. They must change it when they sign in.' : 'They are signed out everywhere and can’t sign in. Their history stays.'}
        confirmLabel={confirm?.kind === 'reset' ? 'Reset password' : 'Deactivate'}
        destructive={confirm?.kind === 'deactivate'}
        loading={update.isPending || reset.isPending}
        onConfirm={() => confirm && (confirm.kind === 'reset' ? reset.mutate(confirm.user) : update.mutate({ id: confirm.user.id, body: { active: false } }))}
      />
      <ResponsiveDialog
        open={temp !== null}
        onOpenChange={(o) => !o && setTemp(null)}
        title="Temporary password"
        description="Read it out once. It won’t be shown again; they choose their own on first sign-in."
        footer={<Button onClick={() => setTemp(null)}>Done</Button>}
      >
        <div className="rounded-xl bg-muted p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Username <strong className="font-mono text-foreground">{temp?.username}</strong>
          </p>
          <p className="mt-2 select-all font-mono text-3xl font-black tracking-wider">{temp?.password}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              navigator.clipboard?.writeText(temp?.password ?? '').then(() => toast.success('Copied'), () => {})
            }}
          >
            <Copy /> Copy
          </Button>
        </div>
      </ResponsiveDialog>
    </>
  )
}

function StaffForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (username: string, password: string) => void }) {
  const [form, setForm] = useState<{ fullName: string; username: string; role: Role }>({ fullName: '', username: '', role: 'VOLUNTEER' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (open) {
      setForm({ fullName: '', username: '', role: 'VOLUNTEER' })
      setErrors({})
    }
  }, [open])
  const create = useApiMutation(() => staffApi.create(form), {
    invalidate: [qk.staff],
    onSuccess: (r) => {
      onClose()
      onCreated(r.user.username, r.temporaryPassword)
    },
    onError: (err) => {
      const e = errorsOf(err)
      setErrors(e)
      return Object.keys(e).length > 0
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate(undefined)
  }
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Add staff"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={submit}>
            <UserPlus /> Create account
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-3">
        <Field label="Full name" htmlFor="s-name" error={errors.fullName}>
          <Input
            id="s-name"
            value={form.fullName}
            autoFocus
            onChange={(e) => {
              const fullName = e.target.value
              setForm((f) => ({ ...f, fullName, username: f.username || '' }))
            }}
            onBlur={() => !form.username && setForm((f) => ({ ...f, username: f.fullName.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9._]/g, '') ?? '' }))}
          />
        </Field>
        <Field label="Username" htmlFor="s-user" error={errors.username}>
          <Input id="s-user" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} autoCapitalize="none" />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Role</legend>
          <div className="flex gap-2">
            {(['VOLUNTEER', 'RECEPTION', 'ADMIN'] as Role[]).map((r) => (
              <Chip key={r} selected={form.role === r} onClick={() => setForm({ ...form, role: r })} className="flex-1">
                {ROLE_LABEL[r]}
              </Chip>
            ))}
          </div>
        </fieldset>
        <button type="submit" hidden />
      </form>
    </ResponsiveDialog>
  )
}

// ── A6 Settings ──────────────────────────────────────────────────────────────
export function SettingsPage() {
  const settings = useQuery({ queryKey: qk.settings, queryFn: settingsApi.get })
  const [form, setForm] = useState<EventSettings | null>(null)
  const [float, setFloat] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (settings.data) {
      setForm(settings.data)
      setFloat(String(settings.data.openingCashFloatPaise / 100))
    }
  }, [settings.data])

  const save = useApiMutation(() => settingsApi.update({ ...form!, openingCashFloatPaise: parseRupees(float) ?? -1 }), {
    invalidate: [qk.settings, qk.floor],
    onSuccess: () => {
      setErrors({})
      toast.success('Settings saved', { description: 'Every board picked up the change — no restart needed.' })
    },
    onError: (err) => {
      const e = errorsOf(err)
      setErrors(e)
      if (!Object.keys(e).length) toast.error(friendlyMessage(err))
      return true
    },
  })

  if (settings.isPending || !form) return <LoadingRows />
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
  const set = <K extends keyof EventSettings>(k: K, v: EventSettings[K]) => setForm({ ...form, [k]: v })
  const dirty = JSON.stringify({ ...form, openingCashFloatPaise: parseRupees(float) }) !== JSON.stringify(settings.data)

  return (
    <>
      <PageHeader title="Settings" description="Operational knobs. Changes apply live on every screen." />
      <form
        className="grid max-w-3xl gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(undefined)
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Event</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Event name" htmlFor="st-name" error={errors.eventName}>
              <Input id="st-name" value={form.eventName} onChange={(e) => set('eventName', e.target.value)} />
            </Field>
            <Field label="Opening cash float (₹)" htmlFor="st-float" error={errors.openingCashFloatPaise} hint="Counted into the box before opening; used in the cash reconciliation">
              <Input id="st-float" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Timers</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="“Ending soon” warning (minutes)" htmlFor="st-warn" error={errors.warningThresholdMinutes} hint="Cards turn amber this long before the end">
              <Input id="st-warn" type="number" min={1} max={30} value={form.warningThresholdMinutes} onChange={(e) => set('warningThresholdMinutes', Number(e.target.value))} />
            </Field>
            <Field label="Cleaning auto-clear (seconds)" htmlFor="st-clean" error={errors.cleaningAutoClearSeconds} hint="0 skips the cleaning state entirely">
              <Input id="st-clean" type="number" min={0} max={900} value={form.cleaningAutoClearSeconds} onChange={(e) => set('cleaningAutoClearSeconds', Number(e.target.value))} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Extensions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-3">
              <Switch checked={form.allowExtensions} onCheckedChange={(v) => set('allowExtensions', v)} />
              <span>
                <span className="block font-medium">Allow extensions</span>
                <span className="block text-xs text-muted-foreground">Volunteers can add time; reception collects later</span>
              </span>
            </label>
            <Field label="Max extra minutes per session" htmlFor="st-max" error={errors.maxExtensionMinutes}>
              <Input id="st-max" type="number" min={5} max={120} step={5} disabled={!form.allowExtensions} value={form.maxExtensionMinutes} onChange={(e) => set('maxExtensionMinutes', Number(e.target.value))} />
            </Field>
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" size="lg" loading={save.isPending} disabled={!dirty}>
            <Save /> Save settings
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            disabled={!dirty}
            onClick={() => {
              setForm(settings.data)
              setFloat(String(settings.data.openingCashFloatPaise / 100))
              setErrors({})
            }}
          >
            Discard changes
          </Button>
        </div>
      </form>
    </>
  )
}

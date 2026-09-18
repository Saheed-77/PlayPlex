import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, CircleCheck, Gift, Info, Smartphone, UserPlus } from 'lucide-react'
import type { PaymentMethod, Plan, Ticket } from '@/types/api'
import { studentsApi, ticketsApi } from '@/api/tickets'
import { ApiError, friendlyMessage } from '@/api/errors'
import { qk, useFloor, usePlans } from '@/hooks/queries'
import { useCanAct } from '@/hooks/useConnection'
import { useDebounce, useIdempotencyKey } from '@/hooks/useUtils'
import { announce } from '@/hooks/useLive'
import { DeviceTypeIcon } from '@/lib/icons'
import { formatPaise } from '@/lib/money'
import { plansForType } from '@/lib/pricing'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, Chip, Field, Input, Kbd, NativeSelect, Skeleton } from '@/components/ui/primitives'
import { PageHeader } from '@/components/common/common'
import { AvailabilityStrip, waitLabel } from '@/components/reception/AvailabilityStrip'

const DEPARTMENTS = ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT', 'AIDS', 'BIOTECH', 'Other']

interface FormState {
  phone: string
  fullName: string
  rollNo: string
  department: string
  yearOfStudy: string
  planId: number | null
  /** 'any' or a device type id */
  preference: string
  method: PaymentMethod
  referenceNo: string
  waiverNote: string
}

const EMPTY: FormState = { phone: '', fullName: '', rollNo: '', department: '', yearOfStudy: '', planId: null, preference: 'any', method: 'CASH', referenceNo: '', waiverNote: '' }

/** R2 — the most-used screen in the app. Keyboard-only, under 60 seconds. */
export function RegisterPage() {
  const qc = useQueryClient()
  const floor = useFloor()
  const plans = usePlans()
  const canAct = useCanAct()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState<Ticket | null>(null)
  const [key, rotateKey] = useIdempotencyKey()
  const phoneRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  // Returning-student lookup, debounced 400 ms.
  const phone = useDebounce(form.phone, 400)
  const lookup = useQuery({
    queryKey: qk.students(phone),
    queryFn: () => studentsApi.search(phone),
    enabled: phone.length === 10,
  })
  const found = phone.length === 10 ? lookup.data?.find((s) => s.phone === phone) : undefined
  const lastFilled = useRef<number | null>(null)
  useEffect(() => {
    if (found && lastFilled.current !== found.id) {
      lastFilled.current = found.id
      setForm((f) => ({
        ...f,
        fullName: found.fullName,
        rollNo: found.rollNo ?? '',
        department: found.department ?? '',
        yearOfStudy: found.yearOfStudy ? String(found.yearOfStudy) : '',
      }))
    }
    if (!found) lastFilled.current = null
  }, [found])

  const prefTypeId = form.preference === 'any' ? null : Number(form.preference)
  const allPlans = plans.data ?? []
  const visiblePlans = useMemo(() => (prefTypeId === null ? allPlans : plansForType(allPlans, prefTypeId)), [allPlans, prefTypeId])
  const plan = allPlans.find((p) => p.id === form.planId)
  const amount = form.method === 'WAIVED' ? 0 : (plan?.pricePaise ?? 0)

  const choosePlan = (p: Plan) => {
    setForm((f) => {
      // A device-specific plan (Sim Sprint) pins the preference to that device.
      const pinned = p.deviceTypeIds.length === 1 ? String(p.deviceTypeIds[0]) : f.preference
      return { ...f, planId: p.id, preference: pinned }
    })
  }

  const choosePreference = (value: string) => {
    setForm((f) => {
      const typeId = value === 'any' ? null : Number(value)
      const stillValid = !plan || plan.deviceTypeIds.length === 0 || (typeId !== null && plan.deviceTypeIds.includes(typeId))
      return { ...f, preference: value, planId: stillValid ? f.planId : null }
    })
  }

  const reset = () => {
    setForm(EMPTY)
    setErrors({})
    lastFilled.current = null
    phoneRef.current?.focus()
  }

  // The success banner holds for 4 seconds, then the desk is ready for the next student.
  useEffect(() => {
    if (!success) return
    const id = setTimeout(() => setSuccess(null), 4000)
    return () => clearTimeout(id)
  }, [success])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!/^[6-9]\d{9}$/.test(form.phone)) errs['student.phone'] = 'Enter a 10-digit mobile number.'
    if (form.fullName.trim().length < 2) errs['student.fullName'] = 'Enter the student’s name.'
    if (!plan) errs.planId = 'Choose a plan.'
    if (form.method === 'WAIVED' && form.waiverNote.trim().length < 3) errs['payment.note'] = 'Say why this ticket is free.'
    setErrors(errs)
    if (Object.keys(errs).length) {
      document.getElementById(Object.keys(errs)[0].replace('student.', 'f-').replace('payment.note', 'f-waiver').replace('planId', 'f-plans'))?.focus()
      return
    }
    setBusy(true)
    try {
      const ticket = await ticketsApi.create(
        {
          student: {
            fullName: form.fullName.trim(),
            phone: form.phone,
            rollNo: form.rollNo.trim() || null,
            department: form.department || null,
            yearOfStudy: form.yearOfStudy ? Number(form.yearOfStudy) : null,
          },
          planId: plan!.id,
          preferredDeviceTypeId: prefTypeId,
          payment: {
            method: form.method,
            amountPaise: amount,
            referenceNo: form.method === 'UPI' ? form.referenceNo.trim() || null : null,
            note: form.method === 'WAIVED' ? form.waiverNote.trim() : null,
          },
        },
        key,
      )
      rotateKey()
      setSuccess(ticket)
      // The ticket number has to be on screen to be read out.
      window.scrollTo({ top: 0, behavior: 'smooth' })
      announce(`Registered ${ticket.ticketNo}`)
      qc.invalidateQueries({ queryKey: qk.floor })
      qc.invalidateQueries({ queryKey: ['tickets'] })
      reset()
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors)
      else setErrors({ form: friendlyMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const types = floor.data?.byDeviceType ?? []
  const prefOptions = [
    { value: 'any', label: 'Any — fastest', icon: null as string | null, wait: floor.data ? waitLabel(floor.data.summary.estimatedWaitMinutes) : '…' },
    ...types.map((t) => ({ value: String(t.id), label: t.name, icon: t.icon, wait: waitLabel(t.estimatedWaitMinutes) })),
  ]

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Register" description={<>Phone first. <Kbd>Tab</Kbd> through the form, <Kbd>Enter</Kbd> to register.</>} />
      <AvailabilityStrip floor={floor.data} className="sticky top-16 z-10 mb-4 shadow-sm" />

      {success && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border-2 border-free bg-free-bg px-6 py-5 motion-safe:animate-banner-in">
          <div>
            <p className="flex items-center gap-2 font-semibold text-free">
              <CircleCheck className="size-5" /> Registered
            </p>
            <p className="font-mono text-5xl font-black tracking-tight">{success.ticketNo}</p>
          </div>
          <div className="text-base">
            <p className="font-semibold">
              {success.student.fullName} · {success.plan.name} · {success.plan.durationMinutes} min
            </p>
            <p className="text-muted-foreground">
              {success.queuePosition ? `Position ${success.queuePosition} in queue` : 'In the queue'}
              {success.estimatedWaitMinutes !== null && ` · ${success.estimatedWaitMinutes === 0 ? 'a device is free now' : `about ${success.estimatedWaitMinutes} minutes`}`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Say the number out loud, write it on the slip, hand it over.</p>
          </div>
        </div>
      )}

      <Card className="p-4 sm:p-6">
        <form onSubmit={submit} noValidate className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-[16rem_1fr] md:items-end">
            <Field label="Phone number" htmlFor="f-phone" error={errors['student.phone']}>
              <Input
                ref={phoneRef}
                id="f-phone"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                maxLength={10}
                placeholder="98765 43210"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                aria-invalid={!!errors['student.phone']}
                className="h-12 text-lg tracking-wider tabular-nums"
              />
            </Field>
            <div className="min-h-12 text-sm" aria-live="polite">
              {form.phone.length === 10 && (lookup.isFetching || phone !== form.phone) ? (
                <Skeleton className="h-6 w-64" />
              ) : found ? (
                <div className="grid gap-1">
                  <p className="flex items-center gap-1.5 text-free">
                    <CircleCheck className="size-4" /> Found: <strong>{found.fullName}</strong>
                    {found.rollNo && ` · ${found.rollNo}`} · {found.visitCount} previous turn{found.visitCount === 1 ? '' : 's'}
                  </p>
                  {found.activeTicketNo && (
                    <p className="flex items-center gap-1.5 text-soon">
                      <Info className="size-4" /> Already has an active ticket: <strong className="font-mono">{found.activeTicketNo}</strong>. Buying another turn is fine.
                    </p>
                  )}
                </div>
              ) : form.phone.length === 10 ? (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <UserPlus className="size-4" /> New student — fill in their details.
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_6rem]">
            <Field label="Full name" htmlFor="f-fullName" error={errors['student.fullName']}>
              <Input id="f-fullName" autoComplete="off" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} aria-invalid={!!errors['student.fullName']} />
            </Field>
            <Field label="Roll number" htmlFor="f-roll">
              <Input id="f-roll" autoComplete="off" value={form.rollNo} onChange={(e) => set('rollNo', e.target.value.toUpperCase())} />
            </Field>
            <Field label="Dept" htmlFor="f-dept">
              <NativeSelect id="f-dept" value={form.department} onChange={(e) => set('department', e.target.value)}>
                <option value="">—</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Year" htmlFor="f-year">
              <NativeSelect id="f-year" value={form.yearOfStudy} onChange={(e) => set('yearOfStudy', e.target.value)}>
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Device preference</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {prefOptions.map((o) => (
                <label
                  key={o.value}
                  className={cn(
                    'flex h-12 cursor-pointer items-center gap-2.5 rounded-lg border-2 px-3 text-sm transition-colors',
                    form.preference === o.value ? 'border-primary bg-primary/10' : 'border-input hover:bg-muted',
                  )}
                >
                  <input type="radio" name="preference" value={o.value} checked={form.preference === o.value} onChange={() => choosePreference(o.value)} className="size-4 accent-[var(--color-primary)]" />
                  {o.icon && <DeviceTypeIcon icon={o.icon} className="size-4 text-muted-foreground" />}
                  <span className="flex-1 font-semibold">{o.label}</span>
                  <span className={cn('font-bold tabular-nums', o.wait === 'NOW' ? 'text-free' : 'text-muted-foreground')}>{o.wait}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Choose a plan</legend>
            <div id="f-plans" tabIndex={-1} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {plans.isPending
                ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)
                : visiblePlans.map((p) => {
                    const selected = form.planId === p.id
                    const only = p.deviceTypeIds.length ? types.filter((t) => p.deviceTypeIds.includes(t.id)).map((t) => t.code).join('/') : null
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => choosePlan(p)}
                        className={cn(
                          'relative flex cursor-pointer flex-col items-start rounded-xl border-2 p-3 text-left transition-colors',
                          selected ? 'border-primary bg-primary/10' : 'border-input hover:bg-muted',
                        )}
                      >
                        {selected && <CircleCheck className="absolute right-2 top-2 size-5 text-primary" aria-hidden />}
                        <span className="pr-6 font-bold">{p.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {p.durationMinutes} min{p.seatsPerTicket > 1 && ` · ${p.seatsPerTicket} players`}
                        </span>
                        <span className="mt-1 text-2xl font-black tabular-nums">{formatPaise(p.pricePaise)}</span>
                        {only && <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-soon">{only} only</span>}
                      </button>
                    )
                  })}
            </div>
            {errors.planId && <p className="mt-1 text-sm text-destructive">{errors.planId}</p>}
            {errors.preferredDeviceTypeId && <p className="mt-1 text-sm text-destructive">{errors.preferredDeviceTypeId}</p>}
          </fieldset>

          <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-end">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Payment</legend>
              <div className="flex gap-2">
                <Chip selected={form.method === 'CASH'} onClick={() => set('method', 'CASH')}>
                  <Banknote /> Cash
                </Chip>
                <Chip selected={form.method === 'UPI'} onClick={() => set('method', 'UPI')}>
                  <Smartphone /> UPI
                </Chip>
                <Chip selected={form.method === 'WAIVED'} onClick={() => set('method', 'WAIVED')}>
                  <Gift /> Waived
                </Chip>
              </div>
            </fieldset>
            {form.method === 'UPI' && (
              <Field label="UPI reference (optional)" htmlFor="f-ref">
                <Input id="f-ref" value={form.referenceNo} onChange={(e) => set('referenceNo', e.target.value)} placeholder="T2409140912" className="max-w-xs" />
              </Field>
            )}
            {form.method === 'WAIVED' && (
              <Field label="Why is it free? (audited)" htmlFor="f-waiver" error={errors['payment.note']}>
                <Input id="f-waiver" value={form.waiverNote} onChange={(e) => set('waiverNote', e.target.value)} placeholder="e.g. Faculty guest" className="max-w-md" aria-invalid={!!errors['payment.note']} />
              </Field>
            )}
          </div>

          <p className="text-sm text-muted-foreground">Your details are used only to manage your session at this event and are deleted afterwards.</p>

          {errors.form && (
            <p role="alert" className="rounded-lg bg-over-bg px-3 py-2 text-sm text-over">
              {errors.form}
            </p>
          )}

          <div className="flex flex-col items-stretch gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-end">
            <p className="text-right text-sm text-muted-foreground">
              Amount due <strong className="ml-2 text-2xl text-foreground tabular-nums">{plan ? formatPaise(amount) : '—'}</strong>
            </p>
            <Button type="submit" size="xl" loading={busy} disabled={!canAct} className="sm:min-w-80">
              {plan ? (form.method === 'WAIVED' ? 'Register · waived' : `Register & collect ${formatPaise(amount)}`) : 'Register'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

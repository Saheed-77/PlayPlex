import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react'
import type { AuditEntry, CsvExportType } from '@/types/api'
import { reportsApi, type Range } from '@/api/reports'
import { auditApi, staffApi } from '@/api/admin'
import { friendlyMessage } from '@/api/errors'
import { qk } from '@/hooks/queries'
import { useServerNow } from '@/hooks/useServerNow'
import { useDebounce } from '@/hooks/useUtils'
import { downloadCsv } from '@/lib/csv'
import { formatPaise } from '@/lib/money'
import { ROLE_LABEL } from '@/lib/roles'
import { formatClock, formatDateTime, formatHour, localDay } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardContent, CardHeader, CardTitle, Field, Input, NativeSelect, Skeleton, TBody, TD, TH, THead, TR, Table } from '@/components/ui/primitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays'
import { EmptyState, ErrorState, LoadingRows, PageHeader, PaymentStatusPill, SearchInput, TicketStatusPill } from '@/components/common/common'
import { ColumnChart, HorizontalBarChart, KpiTile } from '@/components/admin/Charts'

function ExportButton({ type, range, label }: { type: CsvExportType; range: Range; label?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      loading={busy}
      className="no-print"
      onClick={async () => {
        setBusy(true)
        try {
          const csv = await reportsApi.exportCsv(type, range)
          downloadCsv(`playplex-${type}-${range.from}${range.to !== range.from ? `-to-${range.to}` : ''}.csv`, csv)
          toast.success(`${type}.csv downloaded`, { description: 'Contains personal data — the export was logged.' })
        } catch (err) {
          toast.error(friendlyMessage(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <Download /> {label ?? 'Export CSV'}
    </Button>
  )
}

const Row = ({ label, value, strong, negative }: { label: string; value: string; strong?: boolean; negative?: boolean }) => (
  <div className={cn('flex justify-between gap-6 py-1', strong && 'font-bold')}>
    <span>{label}</span>
    <span className={cn('tabular-nums', negative && 'text-over')}>{value}</span>
  </div>
)

/** A5 — Summary · Revenue · Utilisation · Queue · Students, each with CSV export. */
export function ReportsPage() {
  const now = useServerNow()
  const today = localDay(now)
  const [range, setRange] = useState<Range>({ from: today, to: today })
  const valid = range.from <= range.to

  const summary = useQuery({ queryKey: qk.report('summary', range), queryFn: () => reportsApi.summary(range), enabled: valid })
  const revenue = useQuery({ queryKey: qk.report('revenue', range), queryFn: () => reportsApi.revenue(range), enabled: valid })
  const util = useQuery({ queryKey: qk.report('utilization', range), queryFn: () => reportsApi.utilization(range), enabled: valid })
  const queue = useQuery({ queryKey: qk.report('queue', range), queryFn: () => reportsApi.queue(range), enabled: valid })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const q = useDebounce(search, 250)
  const students = useQuery({ queryKey: qk.report('students', { ...range, q, page }), queryFn: () => reportsApi.students({ ...range, q, page }), enabled: valid, placeholderData: (p) => p })

  const s = summary.data
  const expected = s ? s.openingCashFloatPaise + s.revenue.cashPaise + s.revenue.cashRefundsPaise : 0

  return (
    <>
      <PageHeader
        title="Reports"
        description="Numbers come straight from the ledger and session records."
        actions={
          <div className="no-print flex flex-wrap items-end gap-2">
            <Field label="From" htmlFor="r-from">
              <Input id="r-from" type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} className="h-10" />
            </Field>
            <Field label="To" htmlFor="r-to">
              <Input id="r-to" type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} className="h-10" />
            </Field>
            <Button variant="ghost" size="sm" className="h-10" onClick={() => setRange({ from: today, to: today })}>
              Today
            </Button>
          </div>
        }
      />
      {!valid && <p role="alert" className="mb-4 rounded-lg bg-over-bg px-3 py-2 text-sm text-over">“From” must be on or before “To”.</p>}

      <Tabs defaultValue="summary">
        <TabsList className="no-print mb-4">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="utilization">Utilisation</TabsTrigger>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="students">Students</TabsTrigger>
        </TabsList>

        {/* Summary: one printable page, every headline number, and the cash block. */}
        <TabsContent value="summary">
          {!s ? (
            summary.isError ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : <LoadingRows rows={6} />
          ) : (
            <Card className="print-area p-5 sm:p-8">
              <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">Daily summary</h2>
                  <p className="text-sm text-muted-foreground">
                    {range.from === range.to ? range.from : `${range.from} → ${range.to}`} · printed {formatDateTime(now)}
                  </p>
                </div>
                <div className="no-print flex gap-2">
                  <ExportButton type="payments" range={range} label="Payments CSV" />
                  <Button size="sm" onClick={() => window.print()}>
                    <Printer /> Print
                  </Button>
                </div>
              </div>
              <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
                <KpiTile label="Registrations" value={s.registrations} />
                <KpiTile label="Sessions completed" value={s.sessionsCompleted} sub={`${s.sessionsActive} still running`} />
                <KpiTile label="Utilisation" value={`${s.utilizationPct}%`} />
                <KpiTile label="Median wait" value={`${s.medianWaitMinutes} min`} />
                <KpiTile label="Avg session" value={`${s.avgSessionMinutes} min`} />
                <KpiTile label="Overdue > 5 min" value={s.overdueSessions} tone={s.overdueSessions ? 'soon' : undefined} />
                <KpiTile label="No-shows · cancelled" value={`${s.noShows} · ${s.cancellations}`} />
                <KpiTile label="Lost to faults" value={`${s.pausedMinutes} min`} sub={`${s.pausedSessions} session${s.pausedSessions === 1 ? '' : 's'} paused`} tone={s.pausedMinutes > 0 ? 'soon' : undefined} />
                <KpiTile label="Peak hour" value={s.peakHour ? formatHour(s.peakHour) : '—'} />
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <section>
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">Revenue</h3>
                  <Row label="Cash collected" value={formatPaise(s.revenue.cashPaise)} />
                  <Row label="UPI collected" value={formatPaise(s.revenue.upiPaise)} />
                  <Row label="Refunds" value={formatPaise(s.revenue.refundsPaise)} negative />
                  <div className="my-1 border-t" />
                  <Row label="Net revenue" value={formatPaise(s.revenue.totalPaise)} strong />
                  <Row label="Waived (not collected)" value={formatPaise(s.revenue.waivedPaise)} />
                  <Row label="Dues still outstanding" value={formatPaise(s.revenue.outstandingDuesPaise)} negative={s.revenue.outstandingDuesPaise > 0} />
                  <h3 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wider text-muted-foreground">By device type</h3>
                  {s.byDeviceType.map((t) => (
                    <Row key={t.code} label={`${t.name} · ${t.sessions} sessions · ${t.utilizationPct}%`} value={formatPaise(t.revenuePaise)} />
                  ))}
                </section>
                <section className="rounded-xl border-2 border-dashed p-4 font-mono text-sm">
                  <h3 className="mb-3 font-sans text-sm font-bold uppercase tracking-wider">Cash reconciliation</h3>
                  <Row label="Opening float" value={formatPaise(s.openingCashFloatPaise)} />
                  <Row label="Cash collected" value={formatPaise(s.revenue.cashPaise)} />
                  <Row label="Cash refunded" value={formatPaise(s.revenue.cashRefundsPaise)} negative />
                  <div className="my-1 border-t border-foreground/40" />
                  <Row label="Expected in box" value={formatPaise(expected)} strong />
                  <div className="mt-4 flex justify-between gap-6 py-2">
                    <span>Counted</span>
                    <span className="w-32 border-b border-foreground/60">₹</span>
                  </div>
                  <div className="flex justify-between gap-6 py-2">
                    <span>Difference</span>
                    <span className="w-32 border-b border-foreground/60">₹</span>
                  </div>
                  <div className="flex justify-between gap-6 py-2">
                    <span>Counted by</span>
                    <span className="w-32 border-b border-foreground/60" />
                  </div>
                  {s.revenue.outstandingDuesPaise > 0 && (
                    <p className="no-print mt-3 font-sans text-xs text-over">Dues are still outstanding — clear the Dues tab before you count.</p>
                  )}
                </section>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="revenue">
          {!revenue.data ? (
            <LoadingRows />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="lg:col-span-2">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Net revenue per hour</CardTitle>
                  <ExportButton type="payments" range={range} />
                </CardHeader>
                <CardContent>
                  <ColumnChart ariaLabel="Net revenue per hour" data={revenue.data.hourly.map((h) => ({ label: formatHour(h.hour), value: h.amountPaise }))} format={(v) => formatPaise(v)} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>By method</CardTitle>
                </CardHeader>
                <Table>
                  <THead>
                    <TR>
                      <TH>Method</TH>
                      <TH className="text-right">Payments</TH>
                      <TH className="text-right">Net</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {revenue.data.byMethod.map((m) => (
                      <TR key={m.method}>
                        <TD>{m.method}</TD>
                        <TD className="text-right tabular-nums">{m.count}</TD>
                        <TD className="text-right tabular-nums">{formatPaise(m.amountPaise)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>By collector</CardTitle>
                  <p className="text-xs text-muted-foreground">Who touched the money — the first place to look if the box is off.</p>
                </CardHeader>
                <Table>
                  <THead>
                    <TR>
                      <TH>Staff</TH>
                      <TH className="text-right">Payments</TH>
                      <TH className="text-right">Net</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {revenue.data.byCollector.map((c) => (
                      <TR key={c.name}>
                        <TD>{c.name}</TD>
                        <TD className="text-right tabular-nums">{c.count}</TD>
                        <TD className="text-right tabular-nums">{formatPaise(c.amountPaise)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>By plan</CardTitle>
                </CardHeader>
                <CardContent>
                  <HorizontalBarChart ariaLabel="Net revenue by plan" data={revenue.data.byPlan.map((p) => ({ label: p.planName, value: p.amountPaise }))} format={(v) => formatPaise(v)} />
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="utilization">
          {!util.data ? (
            <LoadingRows />
          ) : (
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle>Per device</CardTitle>
                <div className="flex flex-wrap gap-2">
                  {util.data.byType.map((t) => (
                    <Badge key={t.code} tone="run" className="text-sm">
                      {t.code} {t.utilizationPct}% · {t.sessions} sessions
                    </Badge>
                  ))}
                  <ExportButton type="sessions" range={range} />
                </div>
              </CardHeader>
              <Table>
                <THead>
                  <TR>
                    <TH>Device</TH>
                    <TH className="text-right">Sessions</TH>
                    <TH className="text-right">In use</TH>
                    <TH className="text-right">Available</TH>
                    <TH className="text-right">Paused</TH>
                    <TH className="text-right">Down</TH>
                    <TH className="w-1/3">Utilisation</TH>
                  </TR>
                </THead>
                <TBody>
                  {util.data.byDevice.map((d) => (
                    <TR key={d.code}>
                      <TD className="font-mono font-semibold">{d.code}</TD>
                      <TD className="text-right tabular-nums">{d.sessions}</TD>
                      <TD className="text-right tabular-nums">{d.minutesInUse} min</TD>
                      <TD className="text-right tabular-nums">{d.minutesAvailable} min</TD>
                      <TD className={cn('text-right tabular-nums', d.pausedMinutes > 0 && 'text-pause')}>{d.pausedMinutes} min</TD>
                      <TD className={cn('text-right tabular-nums', d.downMinutes > 0 && 'text-soon')}>{d.downMinutes} min</TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-series-1" style={{ width: `${Math.min(100, d.utilizationPct)}%` }} />
                          </div>
                          <span className="w-14 text-right text-sm tabular-nums">{d.utilizationPct}%</span>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="queue">
          {!queue.data ? (
            <LoadingRows />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid grid-cols-3 gap-3 lg:col-span-2">
                <KpiTile label="Median wait" value={`${queue.data.medianWaitMinutes} min`} sub="Target under 15" tone={queue.data.medianWaitMinutes <= 15 ? 'free' : 'soon'} />
                <KpiTile label="90th percentile" value={`${queue.data.p90WaitMinutes} min`} />
                <KpiTile label="No-show rate" value={`${queue.data.noShowRatePct}%`} />
              </div>
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>How long people waited (minutes)</CardTitle>
                  <ExportButton type="tickets" range={range} />
                </CardHeader>
                <CardContent>
                  <ColumnChart ariaLabel="Wait time distribution" data={queue.data.distribution.map((b) => ({ label: b.bucket, value: b.count }))} format={(v) => `${v} tickets`} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Longest waits</CardTitle>
                  <p className="text-xs text-muted-foreground">“Why did PPX-0031 wait 50 minutes?” — skips are in the audit log.</p>
                </CardHeader>
                <Table>
                  <THead>
                    <TR>
                      <TH>Ticket</TH>
                      <TH>Student</TH>
                      <TH className="text-right">Waited</TH>
                      <TH className="text-right">Skipped</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {queue.data.longestWaits.map((w) => (
                      <TR key={w.ticketNo}>
                        <TD className="font-mono">{w.ticketNo}</TD>
                        <TD>{w.name}</TD>
                        <TD className="text-right tabular-nums">{w.waitMinutes} min</TD>
                        <TD className="text-right tabular-nums">{w.skipped || '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="students">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <SearchInput
                value={search}
                onChange={(v) => {
                  setSearch(v)
                  setPage(0)
                }}
                placeholder="Search name, phone, roll no or ticket"
                className="w-full sm:w-96"
              />
              <div className="flex gap-2">
                <ExportButton type="students" range={range} label="Students CSV" />
                <ExportButton type="tickets" range={range} label="Tickets CSV" />
              </div>
            </CardHeader>
            {!students.data ? (
              <LoadingRows className="p-4" />
            ) : students.data.content.length === 0 ? (
              <EmptyState className="m-4" title="No registrations match" />
            ) : (
              <>
                <Table>
                  <THead>
                    <TR>
                      <TH>Ticket</TH>
                      <TH>Student</TH>
                      <TH>Roll no.</TH>
                      <TH>Plan</TH>
                      <TH>Status</TH>
                      <TH>Payment</TH>
                      <TH>Registered</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {students.data.content.map((t) => (
                      <TR key={t.id}>
                        <TD className="font-mono">{t.ticketNo}</TD>
                        <TD>
                          {t.student.fullName}
                          <span className="block text-xs text-muted-foreground tabular-nums">{t.student.phone}</span>
                        </TD>
                        <TD>{t.student.rollNo ?? '—'}</TD>
                        <TD>
                          {t.plan.name} · {formatPaise(t.plan.pricePaise)}
                        </TD>
                        <TD>
                          <TicketStatusPill status={t.status} />
                        </TD>
                        <TD>
                          <PaymentStatusPill status={t.paymentStatus} />
                        </TD>
                        <TD className="tabular-nums">{formatClock(t.queuedAt)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {students.data.totalElements} registrations · page {page + 1} of {students.data.totalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="outline" size="icon-sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
                      <ChevronLeft />
                    </Button>
                    <Button variant="outline" size="icon-sm" disabled={page + 1 >= students.data.totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">
                      <ChevronRight />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}

// ── A7 Audit log ─────────────────────────────────────────────────────────────
const ACTIONS = [
  'TICKET_CANCELLED', 'TICKET_UPDATED', 'TICKET_NO_SHOW', 'TICKET_REQUEUED', 'TICKET_WAIVED', 'PRIORITY_BUMPED', 'QUEUE_SKIPPED',
  'PAYMENT_COLLECTED', 'REFUND_ISSUED', 'SESSION_EXTENDED', 'SESSION_PAUSED', 'SESSION_RESUMED', 'SESSION_AUTO_RESUMED', 'SESSION_LOST_TIME',
  'SESSION_ENDED', 'SESSION_FORCE_ENDED', 'SESSIONS_BULK_ENDED',
  'DEVICE_STATUS_CHANGED', 'DEVICE_CREATED', 'DEVICE_UPDATED', 'DEVICE_DEACTIVATED', 'DEVICE_TYPE_CREATED', 'DEVICE_TYPE_UPDATED',
  'PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_PRICE_CHANGED', 'STAFF_CREATED', 'STAFF_UPDATED', 'STAFF_DEACTIVATED', 'STAFF_REACTIVATED',
  'PASSWORD_RESET', 'SETTINGS_UPDATED', 'SHIFT_ENDED', 'EXPORT_DOWNLOADED',
]

function fmtValue(key: string, v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number' && /paise/i.test(key)) return formatPaise(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function Diff({ entry }: { entry: AuditEntry }) {
  const keys = [...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})])]
  if (keys.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <ul className="grid gap-0.5 text-xs">
      {keys.map((k) => (
        <li key={k} className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground">{k}:</span>
          {entry.before && k in entry.before && (
            <>
              <span className="rounded bg-over-bg px-1 text-over line-through decoration-1">{fmtValue(k, entry.before[k])}</span>
              <ArrowRight className="size-3 text-muted-foreground" aria-label="changed to" />
            </>
          )}
          <span className="rounded bg-free-bg px-1 text-free">{fmtValue(k, entry.after?.[k])}</span>
        </li>
      ))}
    </ul>
  )
}

export function AuditLogPage() {
  const [filters, setFilters] = useState({ action: '', userId: '' as number | '', from: '', to: '' })
  const [page, setPage] = useState(0)
  const params = { ...filters, page }
  const log = useQuery({ queryKey: qk.audit(params), queryFn: () => auditApi.list(params), placeholderData: (p) => p })
  const staff = useQuery({ queryKey: qk.staff, queryFn: staffApi.list })
  const update = (patch: Partial<typeof filters>) => {
    setFilters({ ...filters, ...patch })
    setPage(0)
  }

  return (
    <>
      <PageHeader title="Audit log" description="Who did what, and when. Read-only — nothing here can be edited or deleted." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Action" htmlFor="a-action">
          <NativeSelect id="a-action" value={filters.action} onChange={(e) => update({ action: e.target.value })}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Staff" htmlFor="a-user">
          <NativeSelect id="a-user" value={filters.userId} onChange={(e) => update({ userId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Everyone</option>
            {staff.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({ROLE_LABEL[u.role]})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="From" htmlFor="a-from">
          <Input id="a-from" type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} />
        </Field>
        <Field label="To" htmlFor="a-to">
          <Input id="a-to" type="date" value={filters.to} onChange={(e) => update({ to: e.target.value })} />
        </Field>
      </div>
      <Card>
        {log.isPending ? (
          <LoadingRows className="p-4" rows={8} />
        ) : log.isError ? (
          <ErrorState className="m-4" error={log.error} onRetry={() => log.refetch()} />
        ) : log.data.content.length === 0 ? (
          <EmptyState className="m-4" title="Nothing matches these filters" />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Who</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>Before → after</TH>
                </TR>
              </THead>
              <TBody>
                {log.data.content.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap tabular-nums">{formatDateTime(e.occurredAt)}</TD>
                    <TD>
                      {e.actorName}
                      <span className="block text-xs text-muted-foreground">{ROLE_LABEL[e.actorRole]}</span>
                    </TD>
                    <TD>
                      <Badge tone={/CANCEL|FORCE|DEACTIVATED|REFUND|PRICE|EXPORT|SKIPPED|PRIORITY/.test(e.action) ? 'soon' : 'neutral'}>{e.action}</Badge>
                    </TD>
                    <TD>
                      <span className="font-mono text-sm">{e.entityLabel ?? '—'}</span>
                      <span className="block text-xs text-muted-foreground">{e.entityType}</span>
                    </TD>
                    <TD>
                      <Diff entry={e} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
              <span className="text-muted-foreground">
                {log.data.totalElements} entries · page {page + 1} of {log.data.totalPages}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon-sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
                  <ChevronLeft />
                </Button>
                <Button variant="outline" size="icon-sm" disabled={page + 1 >= log.data.totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
      {log.isFetching && !log.isPending && <Skeleton className="mt-2 h-1" />}
    </>
  )
}

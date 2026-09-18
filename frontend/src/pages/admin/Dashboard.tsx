import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Activity, Ban, Clock, HandCoins, IndianRupee, Square, TriangleAlert, Users } from 'lucide-react'
import { reportsApi } from '@/api/reports'
import { sessionsApi } from '@/api/sessions'
import { qk, useApiMutation, useFloor } from '@/hooks/queries'
import { useServerNow } from '@/hooks/useServerNow'
import { deriveState } from '@/lib/deviceState'
import { formatPaise } from '@/lib/money'
import { formatHour, localDay, minutesBetween } from '@/lib/time'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives'
import { ConfirmDialog, PageHeader } from '@/components/common/common'
import { ColumnChart, HorizontalBarChart, KpiTile } from '@/components/admin/Charts'
import { FloorBoardView } from '@/components/floor/FloorBoardView'

/** A1 — live KPI tiles, two charts, the alert strip that gets acted on, and the board. */
export function DashboardPage() {
  const now = useServerNow()
  const floor = useFloor()
  const today = localDay(now)
  const range = { from: today, to: today }
  const summary = useQuery({ queryKey: qk.report('summary', range), queryFn: () => reportsApi.summary(range), refetchInterval: 30_000 })
  const revenue = useQuery({ queryKey: qk.report('revenue', range), queryFn: () => reportsApi.revenue(range), refetchInterval: 60_000 })
  const [closing, setClosing] = useState(false)
  const endAll = useApiMutation((note: string) => sessionsApi.endAll(note), {
    onSuccess: (r) => {
      toast.success(`Ended ${r.ended} session${r.ended === 1 ? '' : 's'}`)
      setClosing(false)
    },
  })

  const s = summary.data
  const f = floor.data
  const warningMs = (f?.settings.warningThresholdMinutes ?? 5) * 60_000
  const overdue = f?.devices.filter((d) => deriveState(d, now, warningMs).state === 'OVERDUE') ?? []
  const longDown = f?.devices.filter((d) => d.status === 'OUT_OF_SERVICE' && minutesBetween(d.statusChangedAt, now) >= 15) ?? []
  const running = f?.summary.inUse ?? 0

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={f ? `${f.settings.eventName} · today` : 'Today'}
        actions={
          <Button variant="outline" disabled={running === 0} onClick={() => setClosing(true)}>
            <Square /> End all sessions…
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {!s || !f ? (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <KpiTile icon={<IndianRupee />} label="Revenue" value={formatPaise(s.revenue.totalPaise)} sub={`Cash ${formatPaise(s.revenue.cashPaise)} · UPI ${formatPaise(s.revenue.upiPaise)}`} />
            <KpiTile icon={<Users />} label="Registered" value={s.registrations} sub={`${s.registrationsLastHour} in the last hour`} />
            <KpiTile icon={<Activity />} label="In play" value={`${f.summary.inUse} / ${f.summary.totalDevices}`} sub={f.summary.outOfService ? `${f.summary.outOfService} down` : 'All devices up'} tone={f.summary.outOfService ? 'soon' : undefined} />
            <KpiTile icon={<Clock />} label="Waiting" value={f.summary.queueLength} sub={f.summary.estimatedWaitMinutes >= 0 ? `~${f.summary.estimatedWaitMinutes} min for any device` : 'No devices available'} />
            <KpiTile icon={<Activity />} label="Utilisation" value={`${s.utilizationPct}%`} sub={`Median wait ${s.medianWaitMinutes} min · target >75%`} tone={s.utilizationPct >= 75 ? 'free' : undefined} />
          </>
        )}
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sessions started per hour</CardTitle>
          </CardHeader>
          <CardContent>
            {revenue.data ? (
              <ColumnChart
                ariaLabel="Sessions started per hour today"
                data={revenue.data.hourly.map((h) => ({ label: formatHour(h.hour), value: h.sessions }))}
                format={(v) => `${v} session${v === 1 ? '' : 's'}`}
              />
            ) : (
              <Skeleton className="h-[220px]" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Revenue by device type</CardTitle>
          </CardHeader>
          <CardContent>
            {s ? (
              <HorizontalBarChart
                ariaLabel="Revenue by device type today"
                data={[...s.byDeviceType].sort((a, b) => b.revenuePaise - a.revenuePaise).map((t) => ({ label: t.code, value: t.revenuePaise }))}
                format={(v) => formatPaise(v)}
              />
            ) : (
              <Skeleton className="h-[180px]" />
            )}
          </CardContent>
        </Card>
      </div>

      {f && (f.duesCount > 0 || longDown.length > 0 || overdue.length > 0) && (
        <div className="mb-5 flex flex-wrap gap-2" aria-label="Needs attention">
          {f.duesCount > 0 && (
            <Link to="/reception/dues" className="flex min-h-11 items-center gap-2 rounded-lg border border-over/50 bg-over-bg px-3 text-sm font-semibold hover:underline">
              <HandCoins className="size-4 text-over" /> {f.duesCount} ticket{f.duesCount === 1 ? ' has' : 's have'} dues outstanding
            </Link>
          )}
          {longDown.map((d) => (
            <Link key={d.id} to="/admin/devices" className="flex min-h-11 items-center gap-2 rounded-lg border border-soon/50 bg-soon-bg px-3 text-sm font-semibold hover:underline">
              <Ban className="size-4 text-soon" /> {d.code} out of service for {minutesBetween(d.statusChangedAt, now)} min — {d.statusReason}
            </Link>
          ))}
          {overdue.length > 0 && (
            <span className="flex min-h-11 items-center gap-2 rounded-lg border border-over/50 bg-over-bg px-3 text-sm font-semibold">
              <TriangleAlert className="size-4 text-over" /> {overdue.length} session{overdue.length === 1 ? '' : 's'} overdue
            </span>
          )}
        </div>
      )}

      <h2 className="mb-3 text-lg font-bold">Floor</h2>
      <FloorBoardView />

      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title={`End all ${running} running sessions?`}
        description="For closing the room. Every running session ends now as completed and devices go to cleaning."
        confirmLabel="End all sessions"
        destructive
        requireReason
        reasonLabel="Note (audited)"
        loading={endAll.isPending}
        onConfirm={(note) => endAll.mutate(note)}
      />
    </>
  )
}

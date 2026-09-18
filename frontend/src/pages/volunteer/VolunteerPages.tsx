import { useQuery } from '@tanstack/react-query'
import { Eye, Trophy } from 'lucide-react'
import { authApi } from '@/api/auth'
import { sessionsApi } from '@/api/sessions'
import { qk } from '@/hooks/queries'
import { useUser } from '@/hooks/useAuth'
import { formatClock, minutesBetween } from '@/lib/time'
import { Badge, Card, CardContent, CardHeader, CardTitle, TBody, TD, TH, THead, TR, Table } from '@/components/ui/primitives'
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common/common'
import { FloorBoardView } from '@/components/floor/FloorBoardView'
import { HandoverSummaryView } from './HandoverSummary'

/** V1 — a volunteer should be able to work an entire shift here. */
export function FloorBoardPage() {
  const user = useUser()
  const readOnly = user.role === 'RECEPTION'
  return (
    <>
      {readOnly && (
        <p className="mb-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Eye className="size-4" aria-hidden /> Read-only view. Volunteers assign and end sessions from their own screens.
        </p>
      )}
      <FloorBoardView readOnly={readOnly} />
    </>
  )
}

const END_LABEL: Record<string, string> = { COMPLETED: 'Completed', ENDED_EARLY: 'Ended early', TECH_ISSUE: 'Tech issue', ADMIN_OVERRIDE: 'Override' }

/** V4 — my sessions this shift, plus the live handover checklist. */
export function MyShiftPage() {
  const user = useUser()
  const mine = useQuery({ queryKey: qk.mySessions, queryFn: sessionsApi.mine })
  const summary = useQuery({ queryKey: qk.shift, queryFn: authApi.shiftSummary })
  const count = mine.data?.length ?? 0

  return (
    <>
      <PageHeader title="My shift" description={`${user.fullName} · sessions you started since you signed in`} />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Sessions I started</CardTitle>
            <Badge tone="primary" className="text-sm">
              <Trophy /> {count}
            </Badge>
          </CardHeader>
          <CardContent>
            {mine.isPending ? (
              <LoadingRows />
            ) : mine.isError ? (
              <ErrorState error={mine.error} onRetry={() => mine.refetch()} />
            ) : count === 0 ? (
              <EmptyState title="Nothing yet" description="Assign someone from the floor board and it shows up here." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Device</TH>
                    <TH>Players</TH>
                    <TH>Started</TH>
                    <TH>Length</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {mine.data!.map((s) => (
                    <TR key={s.id}>
                      <TD className="font-semibold">{s.deviceCode}</TD>
                      <TD>
                        {s.playerNames.join(' & ')} <span className="font-mono text-xs text-muted-foreground">{s.ticketNos.join(' ')}</span>
                      </TD>
                      <TD className="tabular-nums">{formatClock(s.startedAt)}</TD>
                      <TD className="tabular-nums">
                        {minutesBetween(s.startedAt, s.endedAt ?? s.plannedEndAt)} min
                        {s.extensionMinutesTotal > 0 && <span className="text-muted-foreground"> (+{s.extensionMinutesTotal})</span>}
                      </TD>
                      <TD>{s.endedAt ? <Badge>{END_LABEL[s.endReason ?? 'COMPLETED']}</Badge> : <Badge tone="run">Running</Badge>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Handover checklist</CardTitle>
            <p className="text-sm text-muted-foreground">Use “End shift” in the menu when you leave.</p>
          </CardHeader>
          <CardContent>
            <HandoverSummaryView summary={summary.data} loading={summary.isPending} />
          </CardContent>
        </Card>
      </div>
    </>
  )
}

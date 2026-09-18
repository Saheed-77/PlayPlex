import { Ban, CircleCheck, HandCoins, Play, TriangleAlert } from 'lucide-react'
import type { HandoverSummary } from '@/types/api'
import { formatPaise } from '@/lib/money'
import { formatClock } from '@/lib/time'
import { LoadingRows } from '@/components/common/common'

/** The five-line handover checklist from docs/02 §8, as data. */
export function HandoverSummaryView({ summary, loading }: { summary?: HandoverSummary; loading?: boolean }) {
  if (loading || !summary) return <LoadingRows rows={4} />
  const sections = [
    {
      icon: TriangleAlert,
      tone: 'text-over',
      title: 'Overdue — end or extend these first',
      rows: summary.overdue.map((s) => `${s.deviceCode} · ${s.players.join(' & ')} · was due ${formatClock(s.plannedEndAt)}`),
    },
    {
      icon: Ban,
      tone: 'text-out',
      title: 'Out of service',
      rows: summary.outOfService.map((d) => `${d.deviceCode} · ${d.reason ?? 'no reason'} · since ${formatClock(d.since)}`),
    },
    {
      icon: HandCoins,
      tone: 'text-soon',
      title: 'Owe money at the desk',
      rows: summary.paymentDue.map((t) => `${t.ticketNo} · ${t.displayName} · ${formatPaise(t.amountDuePaise)}`),
    },
    {
      icon: Play,
      tone: 'text-run',
      title: 'Still running (fine to hand over)',
      rows: summary.running.map((s) => `${s.deviceCode} · ${s.players.join(' & ')} · until ${formatClock(s.plannedEndAt)}`),
    },
  ]
  return (
    <div className="grid gap-4">
      <div className="rounded-xl bg-primary/10 p-4 text-center">
        <p className="text-4xl font-black tabular-nums text-primary">{summary.sessionsStarted}</p>
        <p className="text-sm">sessions started this shift — nice work, {summary.userName.split(' ')[0]}!</p>
      </div>
      {sections.map((s) => (
        <section key={s.title}>
          <h3 className={`mb-1 flex items-center gap-2 text-sm font-bold ${s.tone}`}>
            <s.icon className="size-4" aria-hidden /> {s.title} <span className="text-muted-foreground">({s.rows.length})</span>
          </h3>
          {s.rows.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CircleCheck className="size-4 text-free" aria-hidden /> Nothing here
            </p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {s.rows.map((r) => (
                <li key={r} className="rounded-md bg-muted/60 px-2.5 py-1.5">
                  {r}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, EllipsisVertical, HandCoins, PartyPopper, Star } from 'lucide-react'
import type { Ticket, TicketStatus } from '@/types/api'
import { ticketsApi } from '@/api/tickets'
import { qk } from '@/hooks/queries'
import { useUser } from '@/hooks/useAuth'
import { useServerNow } from '@/hooks/useServerNow'
import { useDebounce } from '@/hooks/useUtils'
import { formatPaise } from '@/lib/money'
import { formatClock, formatMinutes, minutesBetween } from '@/lib/time'
import { Button } from '@/components/ui/button'
import { Badge, Card, Chip, TBody, TD, TH, THead, TR, Table } from '@/components/ui/primitives'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays'
import { EmptyState, ErrorState, LoadingRows, PageHeader, PaymentStatusPill, SearchInput, TicketStatusPill } from '@/components/common/common'
import { ACTION_META, TicketActionDialog, TicketDrawer, availableActions, type TicketAction } from '@/components/reception/TicketDialogs'

const FILTERS: { value: TicketStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'ASSIGNED', label: 'Playing' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'NO_SHOW', label: 'No-show' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

function useTicketActions() {
  const [drawerId, setDrawerId] = useState<number | null>(null)
  const [action, setAction] = useState<{ ticket: Ticket; action: TicketAction } | null>(null)
  const ui = (
    <>
      <TicketDrawer ticketId={drawerId} onClose={() => setDrawerId(null)} onAction={(ticket, a) => setAction({ ticket, action: a })} />
      <TicketActionDialog ticket={action?.ticket ?? null} action={action?.action ?? null} onClose={() => setAction(null)} />
    </>
  )
  return { openDrawer: setDrawerId, act: (ticket: Ticket, a: TicketAction) => setAction({ ticket, action: a }), ui }
}

function WaitCell({ t, now }: { t: Ticket; now: number }) {
  if (t.status === 'QUEUED')
    return (
      <span>
        {formatMinutes(minutesBetween(t.queuedAt, now))}
        {t.estimatedWaitMinutes !== null && <span className="block text-xs text-muted-foreground">~{t.estimatedWaitMinutes} min more</span>}
      </span>
    )
  if (t.assignedAt) return <span className="text-muted-foreground">{formatMinutes(minutesBetween(t.queuedAt, t.assignedAt))}</span>
  return <span className="text-muted-foreground">—</span>
}

/** R4 — today's registrations: search, filter, drawer with the ledger. */
export function RegistrationsPage() {
  const user = useUser()
  const now = useServerNow()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<TicketStatus | ''>('')
  const [page, setPage] = useState(0)
  const q = useDebounce(search, 250)
  const params = { q, status, page, size: 25 }
  const list = useQuery({ queryKey: qk.tickets(params), queryFn: () => ticketsApi.list(params), placeholderData: (prev) => prev })
  const { openDrawer, act, ui } = useTicketActions()
  const isAdmin = user.role === 'ADMIN'

  return (
    <>
      <PageHeader title="Today’s registrations" description="Search by name, phone or ticket number. Click a row for the full ledger." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v)
            setPage(0)
          }}
          placeholder="Search name, phone or PPX-…"
          className="lg:w-96"
        />
        <div className="flex gap-1.5 overflow-x-auto" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <Chip
              key={f.label}
              selected={status === f.value}
              onClick={() => {
                setStatus(f.value)
                setPage(0)
              }}
              className="h-9 shrink-0 px-3"
            >
              {f.label}
            </Chip>
          ))}
        </div>
      </div>

      <Card>
        {list.isPending ? (
          <LoadingRows className="p-4" rows={8} />
        ) : list.isError ? (
          <ErrorState className="m-4" error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.content.length === 0 ? (
          <EmptyState className="m-4" title="No tickets match" description={q ? 'Try part of the name or the last digits of the phone.' : 'Registrations appear here as they happen.'} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Ticket</TH>
                <TH>Student</TH>
                <TH>Plan</TH>
                <TH>Status</TH>
                <TH>Payment</TH>
                <TH>Queued</TH>
                <TH>Wait</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {list.data.content.map((t) => {
                const actions = availableActions(t, isAdmin)
                return (
                  <TR key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDrawer(t.id)}>
                    <TD className="font-mono font-semibold">
                      {t.ticketNo}
                      {t.priority > 0 && <Star className="ml-1 inline size-3.5 fill-soon text-soon" aria-label="Priority" />}
                    </TD>
                    <TD>
                      <span className="font-semibold">{t.student.fullName}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">{t.student.phone}</span>
                    </TD>
                    <TD>
                      {t.plan.name}
                      <span className="block text-xs text-muted-foreground">
                        {t.plan.durationMinutes}m · {formatPaise(t.plan.pricePaise)} · {t.preferredDeviceType?.code ?? 'Any'}
                      </span>
                    </TD>
                    <TD>
                      <TicketStatusPill status={t.status} />
                      {t.deviceCode && <span className="block text-xs text-muted-foreground">on {t.deviceCode}</span>}
                    </TD>
                    <TD>
                      <PaymentStatusPill status={t.paymentStatus} />
                      {t.amountDuePaise > 0 && <span className="block text-xs font-semibold text-over">{formatPaise(t.amountDuePaise)}</span>}
                    </TD>
                    <TD className="tabular-nums">{formatClock(t.queuedAt)}</TD>
                    <TD className="tabular-nums">
                      <WaitCell t={t} now={now} />
                    </TD>
                    <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                      {actions.includes('collect') && (
                        <Button size="sm" className="mr-1" onClick={() => act(t, 'collect')}>
                          <HandCoins /> Collect
                        </Button>
                      )}
                      {actions.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.ticketNo}`}>
                              <EllipsisVertical />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {actions.map((a) => {
                              const M = ACTION_META[a]
                              return (
                                <DropdownMenuItem key={a} destructive={a === 'cancel'} onSelect={() => act(t, a)}>
                                  <M.icon /> {M.label}
                                </DropdownMenuItem>
                              )
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
        {list.data && list.data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
            <span className="text-muted-foreground">
              {list.data.totalElements} tickets · page {page + 1} of {list.data.totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="icon-sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon-sm" disabled={page + 1 >= list.data.totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>
      {ui}
    </>
  )
}

/** R5 — the tab that must be empty before close. */
export function DuesPage() {
  const list = useQuery({ queryKey: qk.tickets({ dues: true }), queryFn: () => ticketsApi.list({ dues: true, size: 200 }) })
  const { openDrawer, act, ui } = useTicketActions()
  const rows = list.data?.content ?? []
  const owed = rows.filter((t) => t.paymentStatus === 'PAYMENT_DUE').reduce((n, t) => n + t.amountDuePaise, 0)
  const refunds = rows.filter((t) => t.paymentStatus === 'REFUND_DUE').reduce((n, t) => n + t.amountDuePaise, 0)

  return (
    <>
      <PageHeader
        title="Dues"
        description="Extensions played but not paid, and refunds owed after device faults. This list must be empty before close."
        actions={
          rows.length > 0 && (
            <div className="flex gap-2">
              <Badge tone="over" className="px-3 py-1.5 text-sm">
                To collect {formatPaise(owed)}
              </Badge>
              <Badge tone="soon" className="px-3 py-1.5 text-sm">
                To refund {formatPaise(refunds)}
              </Badge>
            </div>
          )
        }
      />
      {list.isPending ? (
        <LoadingRows />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<PartyPopper />} title="All clear" description="Nothing owed either way. You’re ready to close." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => {
            const refund = t.paymentStatus === 'REFUND_DUE'
            return (
              <li key={t.id}>
                <Card className={refund ? 'border-soon/60' : 'border-over/60'}>
                  <button type="button" className="block w-full cursor-pointer p-4 text-left" onClick={() => openDrawer(t.id)}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-lg font-bold">{t.ticketNo}</span>
                      <PaymentStatusPill status={t.paymentStatus} />
                    </div>
                    <p className="font-semibold">{t.student.fullName}</p>
                    <p className="text-sm text-muted-foreground tabular-nums">{t.student.phone}</p>
                    <p className="mt-2 text-sm">
                      {refund ? 'Session cut short by a fault — ' : 'Extension on '}
                      {t.deviceCode ?? t.preferredDeviceType?.code ?? 'a device'} · <TicketStatusPill status={t.status} />
                    </p>
                    <p className={`mt-2 text-3xl font-black tabular-nums ${refund ? 'text-soon' : 'text-over'}`}>{formatPaise(t.amountDuePaise)}</p>
                  </button>
                  <div className="flex gap-2 border-t p-3">
                    {refund ? (
                      <>
                        <Button variant="outline" className="flex-1" onClick={() => act(t, 'refund')}>
                          Refund
                        </Button>
                        <p className="flex-1 self-center text-xs text-muted-foreground">or let them play their reissued turn — it clears when assigned</p>
                      </>
                    ) : (
                      <Button className="flex-1" onClick={() => act(t, 'collect')}>
                        <HandCoins /> Collect {formatPaise(t.amountDuePaise)}
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      {ui}
    </>
  )
}

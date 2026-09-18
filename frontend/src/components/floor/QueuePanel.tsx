import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { EllipsisVertical, Star, UserX } from 'lucide-react'
import type { DeviceTypeSummary } from '@/types/api'
import { floorApi } from '@/api/floor'
import { ticketsApi } from '@/api/tickets'
import { qk, useApiMutation } from '@/hooks/queries'
import { useCanAct } from '@/hooks/useConnection'
import { useDebounce } from '@/hooks/useUtils'
import { DeviceTypeIcon } from '@/lib/icons'
import { formatMinutes } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/primitives'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/overlays'
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, SearchInput } from '@/components/common/common'

export function QueuePanel({ typeFilter, types, operable, className }: { typeFilter: number | null; types: DeviceTypeSummary[]; operable: boolean; className?: string }) {
  const [search, setSearch] = useState('')
  const q = useDebounce(search, 250)
  const canAct = useCanAct()
  const [noShow, setNoShow] = useState<{ id: number; label: string } | null>(null)

  const queue = useQuery({ queryKey: qk.queue(typeFilter, q), queryFn: () => floorApi.queue({ deviceTypeId: typeFilter, q }) })
  const markNoShow = useApiMutation((id: number) => ticketsApi.noShow(id), {
    invalidate: [qk.floor, ['queue']],
    onSuccess: () => {
      toast.success(`${noShow?.label} marked as a no-show`, { description: 'Reception can put them back in the queue if they turn up.' })
      setNoShow(null)
    },
  })
  const typeById = new Map(types.map((t) => [t.id, t]))
  const items = queue.data?.items ?? []

  return (
    <section aria-label="Queue" className={cn('flex min-h-0 flex-col', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Queue <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-foreground tabular-nums">{queue.data ? items.length : '…'}</span>
        </h2>
        {typeFilter !== null && <span className="text-xs text-muted-foreground">for {typeById.get(typeFilter)?.name ?? 'this type'} + “any”</span>}
      </div>
      <SearchInput value={search} onChange={setSearch} placeholder="Search the queue…" className="mb-3" />

      {queue.isPending ? (
        <LoadingRows rows={6} />
      ) : queue.isError ? (
        <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={q ? 'No match' : 'Queue is empty'} description={q ? 'Try a ticket number or first name.' : 'Everyone waiting has been seated.'} />
      ) : (
        <ol className="grid min-h-0 gap-2 overflow-y-auto pr-1">
          {items.map((item) => {
            const type = item.preferredDeviceTypeId === null ? null : typeById.get(item.preferredDeviceTypeId)
            return (
              <li key={item.ticketId} className="flex items-start gap-2 rounded-lg border bg-card p-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-sm font-bold tabular-nums">{item.position}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-muted-foreground">{item.ticketNo}</span>
                    {item.priority > 0 && <Star className="size-4 fill-soon text-soon" aria-label="Priority ticket" />}
                  </p>
                  <p className="truncate font-semibold">{item.fullName ?? item.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.planName} {item.durationMinutes}m
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs">
                    {type ? <DeviceTypeIcon icon={type.icon} className="size-3.5" /> : null}
                    <span>{type?.name ?? 'Any'}</span>
                    <span className="text-muted-foreground">· waiting {formatMinutes(item.waitingMinutes)}</span>
                  </p>
                  {item.paymentStatus === 'PAYMENT_DUE' && (
                    <Badge tone="over" className="mt-1">
                      Pay at desk
                    </Badge>
                  )}
                </div>
                {operable && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${item.ticketNo}`} disabled={!canAct}>
                        <EllipsisVertical />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel>
                        {item.ticketNo} · {item.displayName}
                      </DropdownMenuLabel>
                      <DropdownMenuItem destructive onSelect={() => setNoShow({ id: item.ticketId, label: `${item.ticketNo} (${item.displayName})` })}>
                        <UserX /> Called — not here (no-show)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <ConfirmDialog
        open={noShow !== null}
        onOpenChange={(o) => !o && setNoShow(null)}
        title={`Mark ${noShow?.label} as a no-show?`}
        description="They leave the queue. If they come back, reception can requeue them in their original place."
        confirmLabel="Mark no-show"
        destructive
        loading={markNoShow.isPending}
        onConfirm={() => noShow && markNoShow.mutate(noShow.id)}
      />
    </section>
  )
}

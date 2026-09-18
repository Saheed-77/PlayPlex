import { useState, type ReactNode } from 'react'
import { AlertTriangle, CircleCheck, Inbox, RotateCcw, Search, X } from 'lucide-react'
import type { PaymentStatus, TicketStatus } from '@/types/api'
import { friendlyMessage } from '@/api/errors'
import { useIsPhone } from '@/hooks/useUtils'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge, Input, Label, Skeleton, Textarea, type BadgeTone } from '@/components/ui/primitives'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays'

export function PageHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center', className)}>
      <div className="mb-1 text-muted-foreground [&_svg]:size-8">{icon ?? <Inbox />}</div>
      <p className="font-semibold">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error?: unknown; onRetry?: () => void; className?: string }) {
  const detail = friendlyMessage(error)
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-2 rounded-xl border border-over/40 bg-over-bg px-6 py-10 text-center', className)}>
      <AlertTriangle className="size-7 text-over" aria-hidden />
      <p className="font-semibold">Couldn’t load this</p>
      <p className="text-sm text-muted-foreground">{detail}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RotateCcw /> Try again
        </Button>
      )}
    </div>
  )
}

export function LoadingRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('grid gap-2', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, className, id }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string; id?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-9 pr-10" />
      {value && (
        <button type="button" onClick={() => onChange('')} className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label="Clear search">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

// ── Status pills: colour + text, never colour alone (P2) ────────────────────
const TICKET: Record<TicketStatus, { tone: BadgeTone; label: string }> = {
  QUEUED: { tone: 'run', label: 'Queued' },
  ASSIGNED: { tone: 'free', label: 'Playing' },
  COMPLETED: { tone: 'neutral', label: 'Completed' },
  NO_SHOW: { tone: 'soon', label: 'No-show' },
  CANCELLED: { tone: 'out', label: 'Cancelled' },
}

export function TicketStatusPill({ status }: { status: TicketStatus }) {
  const s = TICKET[status]
  return <Badge tone={s.tone}>{s.label}</Badge>
}

const PAYMENT: Record<PaymentStatus, { tone: BadgeTone; label: string }> = {
  PAID: { tone: 'free', label: 'Paid' },
  PAYMENT_DUE: { tone: 'over', label: 'Payment due' },
  REFUND_DUE: { tone: 'soon', label: 'Refund due' },
  WAIVED: { tone: 'clean', label: 'Waived' },
  REFUNDED: { tone: 'neutral', label: 'Refunded' },
}

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  const s = PAYMENT[status]
  return <Badge tone={s.tone}>{s.label}</Badge>
}

// ── Dialogs ──────────────────────────────────────────────────────────────────
/** A bottom sheet on phones, a centred dialog elsewhere (docs/05 §6). */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  onOpenAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
  /** Override where focus lands when the dialog opens. */
  onOpenAutoFocus?: (e: Event) => void
}) {
  const phone = useIsPhone()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheet={phone} className={className} onOpenAutoFocus={onOpenAutoFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{String(title)}</DialogDescription>}
        </DialogHeader>
        {children && <DialogBody>{children}</DialogBody>}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Destructive actions confirm (P5). With `requireReason`, the button stays disabled
 * until a reason is typed — used for force-end and other overrides.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  requireReason,
  reasonLabel = 'Reason',
  loading,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmLabel: string
  destructive?: boolean
  requireReason?: boolean
  reasonLabel?: string
  loading?: boolean
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const ok = !requireReason || reason.trim().length >= 3
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason('')
        onOpenChange(o)
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={!ok} loading={loading} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {requireReason && (
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-reason">{reasonLabel}</Label>
          <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="This is written to the audit log" autoFocus />
        </div>
      )}
    </ResponsiveDialog>
  )
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-free">
      <CircleCheck className="size-4" aria-hidden /> {children}
    </p>
  )
}

export function Stat({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg bg-muted/60 px-3 py-2', className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  )
}

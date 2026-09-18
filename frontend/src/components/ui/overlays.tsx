import * as React from 'react'
import { Dialog as D, DropdownMenu as M, Switch as S, Tabs as T } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Dialog / bottom sheet ────────────────────────────────────────────────────
export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({
  className,
  children,
  sheet = false,
  hideClose = false,
  ...props
}: React.ComponentProps<typeof D.Content> & { sheet?: boolean; hideClose?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
      <D.Content
        className={cn(
          'fixed z-50 flex max-h-[92dvh] flex-col overflow-hidden border bg-popover text-foreground shadow-2xl outline-none',
          sheet
            ? 'inset-x-0 bottom-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]'
            : 'left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl',
          className,
        )}
        {...props}
      >
        {sheet && <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted" aria-hidden />}
        {children}
        {!hideClose && (
          <D.Close className="absolute right-3 top-3 grid size-11 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-5" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  )
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('grid gap-1 border-b px-5 py-4 pr-14', className)} {...props} />
}
export function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('grid gap-4 overflow-y-auto px-5 py-4', className)} {...props} />
}
export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col-reverse gap-2 border-t px-5 py-3 sm:flex-row sm:justify-end', className)} {...props} />
}
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof D.Title>) {
  return <D.Title className={cn('text-lg font-semibold leading-tight', className)} {...props} />
}
export function DialogDescription({ className, ...props }: React.ComponentProps<typeof D.Description>) {
  return <D.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
}

// ── Dropdown menu ────────────────────────────────────────────────────────────
export const DropdownMenu = M.Root
export const DropdownMenuTrigger = M.Trigger

export function DropdownMenuContent({ className, align = 'end', ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-52 overflow-hidden rounded-xl border bg-popover p-1 text-foreground shadow-xl', className)}
        {...props}
      />
    </M.Portal>
  )
}

export function DropdownMenuItem({ className, destructive, ...props }: React.ComponentProps<typeof M.Item> & { destructive?: boolean }) {
  return (
    <M.Item
      className={cn(
        'flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-muted-foreground',
        destructive && 'text-destructive [&_svg]:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn('px-3 py-2 text-xs font-semibold text-muted-foreground', className)} {...props} />
}

export function DropdownMenuSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
export const Tabs = T.Root
export const TabsContent = T.Content

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn('inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-muted p-1', className)} {...props} />
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'inline-flex h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-semibold text-muted-foreground transition-colors data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  )
}

// ── Switch ───────────────────────────────────────────────────────────────────
export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        'peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors data-[state=checked]:bg-primary disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <S.Thumb className="pointer-events-none block size-6 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5" />
    </S.Root>
  )
}

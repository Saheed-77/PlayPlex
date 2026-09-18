import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { KeyRound, ShieldAlert } from 'lucide-react'
import { authApi } from '@/api/auth'
import { ApiError, friendlyMessage } from '@/api/errors'
import { useAuth } from '@/hooks/useAuth'
import { homePath } from '@/lib/roles'
import { Button } from '@/components/ui/button'
import { Card, Field, Input } from '@/components/ui/primitives'
import { EmptyState } from '@/components/common/common'
import { Wordmark } from '@/components/shell/AppShell'

/** Forced on first login for accounts created with a temporary password (07 §4.8). */
export function ChangePasswordPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  if (!user) return <Navigate to="/login" replace />
  const forced = user.mustChangePassword

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) return setErrors({ confirm: 'The two passwords don’t match.' })
    setBusy(true)
    setErrors({})
    try {
      const updated = await authApi.changePassword(current, next)
      qc.setQueryData(['auth', 'me'], updated)
      toast.success('Password changed')
      navigate(homePath(updated.role), { replace: true })
    } catch (err) {
      setErrors(err instanceof ApiError && Object.keys(err.fieldErrors).length ? err.fieldErrors : { newPassword: friendlyMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Wordmark className="text-lg" />
        </div>
        <Card className="p-5">
          <h1 className="mb-1 flex items-center gap-2 text-lg font-bold">
            <KeyRound className="size-5 text-primary" /> {forced ? 'Choose your own password' : 'Change password'}
          </h1>
          <p className="mb-4 text-sm text-muted-foreground">
            {forced ? 'You signed in with a temporary password. Pick a new one before you continue.' : 'At least 8 characters.'}
          </p>
          <form onSubmit={submit} className="grid gap-3" noValidate>
            <Field label={forced ? 'Temporary password' : 'Current password'} htmlFor="cur" error={errors.currentPassword}>
              <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus aria-invalid={!!errors.currentPassword} />
            </Field>
            <Field label="New password" htmlFor="new" error={errors.newPassword} hint="At least 8 characters">
              <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={!!errors.newPassword} />
            </Field>
            <Field label="Repeat new password" htmlFor="confirm" error={errors.confirm}>
              <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} />
            </Field>
            <Button type="submit" size="lg" loading={busy} disabled={!current || !next || !confirm}>
              Save password
            </Button>
            {!forced && (
              <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            )}
          </form>
        </Card>
      </div>
    </div>
  )
}

export function ForbiddenPage() {
  const { user } = useAuth()
  return (
    <EmptyState
      icon={<ShieldAlert />}
      title="Your role can’t open this page"
      description="Ask the event lead if you think you need access."
      action={
        <Button asChild variant="outline">
          <Link to={user ? homePath(user.role) : '/login'}>Go to my home screen</Link>
        </Button>
      }
    />
  )
}

export function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="That link doesn’t go anywhere."
      action={
        <Button asChild variant="outline">
          <Link to="/">Back to start</Link>
        </Button>
      }
    />
  )
}

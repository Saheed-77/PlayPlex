import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { LogIn } from 'lucide-react'
import { API_MODE } from '@/api/client'
import { demoPanelEnabled } from '@/lib/demoFlag'
import { friendlyMessage } from '@/api/errors'
import { useAuth } from '@/hooks/useAuth'
import { homePath } from '@/lib/roles'
import { Button } from '@/components/ui/button'
import { Card, Field, Input } from '@/components/ui/primitives'
import { Wordmark } from '@/components/shell/AppShell'

const DEMO_ACCOUNTS = [
  { username: 'priya', label: 'Reception', who: 'Priya Raman' },
  { username: 'meera', label: 'Volunteer', who: 'Meera S' },
  { username: 'admin', label: 'Admin', who: 'Asha Menon' },
  { username: 'newbie', label: 'New volunteer', who: 'must change password' },
]

/** R1 — username, password, big Sign in button. Errors inline, never a modal. */
export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : homePath(user.role)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const u = await login(username.trim(), password)
      navigate(u.mustChangePassword ? '/change-password' : homePath(u.role), { replace: true })
    } catch (err) {
      setError(friendlyMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--color-primary)_16%,transparent),transparent_60%)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Wordmark className="text-xl" />
          <p className="mt-2 text-sm text-muted-foreground">Gaming room operations</p>
        </div>
        <Card className="p-5">
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <Field label="Username" htmlFor="username">
              <Input id="username" autoComplete="username" autoCapitalize="none" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={!!error} required />
            </Field>
            <Field label="Password" htmlFor="password" error={error ?? undefined}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'password-error' : undefined}
                required
              />
            </Field>
            <Button type="submit" size="lg" loading={busy} disabled={!username || !password}>
              <LogIn /> Sign in
            </Button>
          </form>
        </Card>

        {API_MODE === 'mock' && (
          <div className="mt-6 rounded-xl border border-dashed p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Demo accounts · password demo1234</p>
            <div className="grid gap-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.username}
                  type="button"
                  onClick={() => {
                    setUsername(a.username)
                    setPassword('demo1234')
                    setError(null)
                  }}
                  className="flex h-11 cursor-pointer items-center justify-between rounded-lg bg-muted/60 px-3 text-left text-sm hover:bg-muted"
                >
                  <span>
                    <strong>{a.label}</strong> <span className="text-muted-foreground">· {a.who}</span>
                  </span>
                  <code className="text-xs text-muted-foreground">{a.username}</code>
                </button>
              ))}
            </div>
            {!demoPanelEnabled() && (
              <p className="mt-3 text-xs text-muted-foreground">
                Running the demo? Open <code className="rounded bg-muted px-1 py-0.5">?demo=1</code> for the controls: role switch, simulated traffic, clock speed and network states.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

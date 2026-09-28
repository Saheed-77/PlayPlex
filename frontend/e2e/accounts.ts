import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test'
import { request } from '@playwright/test'

/**
 * The stack ships with exactly one account — the seeded admin — because handing out
 * pre-made volunteer logins is how an event ends up with a shared password on a sticky
 * note. So the tests make their own staff the same way the event lead does on the morning:
 * admin creates the account, the server issues a one-time password, and the new person
 * changes it on first sign-in.
 *
 * Running twice must not fail, so an account that already exists is simply reset.
 */

export const ADMIN = { username: 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'playplex' }

export interface Account {
  username: string
  password: string
  fullName: string
  role: 'RECEPTION' | 'VOLUNTEER'
}

export const RECEPTION: Account = { username: 'e2e.reception', password: 'e2e-reception-pw', fullName: 'E2E Reception', role: 'RECEPTION' }
export const VOLUNTEER: Account = { username: 'e2e.volunteer', password: 'e2e-volunteer-pw', fullName: 'E2E Volunteer', role: 'VOLUNTEER' }

export async function loginApi(baseURL: string, username: string, password: string): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL })
  const res = await api.post('/api/auth/login', { data: { username, password } })
  if (!res.ok()) {
    throw new Error(`Could not sign in as ${username}: ${res.status()} ${await res.text()}`)
  }
  return api
}

/** Signs in as admin, tolerating the seeded account still being on its first password. */
async function adminApi(baseURL: string): Promise<APIRequestContext> {
  try {
    return await loginApi(baseURL, ADMIN.username, ADMIN.password)
  } catch (first) {
    // A stack someone has already used will have had its admin password changed.
    const fallback = process.env.E2E_ADMIN_PASSWORD_FALLBACK
    if (!fallback) throw first
    return loginApi(baseURL, ADMIN.username, fallback)
  }
}

export async function ensureAccounts(baseURL: string): Promise<void> {
  const admin = await adminApi(baseURL)
  try {
    const existing = await (await admin.get('/api/admin/users')).json()
    for (const account of [RECEPTION, VOLUNTEER]) {
      const found = existing.find((u: { username: string }) => u.username === account.username)
      let temporary: string
      if (found) {
        // Make sure a previous run left it usable: active, right role, known password.
        await admin.patch(`/api/admin/users/${found.id}`, { data: { active: true, role: account.role } })
        temporary = (await (await admin.post(`/api/admin/users/${found.id}/reset-password`)).json()).temporaryPassword
      } else {
        const created = await admin.post('/api/admin/users', {
          data: { username: account.username, fullName: account.fullName, role: account.role },
        })
        if (!created.ok()) throw new Error(`Could not create ${account.username}: ${await created.text()}`)
        temporary = (await created.json()).temporaryPassword
      }
      // First sign-in: swap the one-time password for the one the tests use.
      const theirs = await loginApi(baseURL, account.username, temporary)
      const changed = await theirs.post('/api/auth/change-password', {
        data: { currentPassword: temporary, newPassword: account.password },
      })
      if (!changed.ok()) throw new Error(`Could not set ${account.username}'s password: ${await changed.text()}`)
      await theirs.dispose()
    }
  } finally {
    await admin.dispose()
  }
}

/** A browser context already holding this person's session cookie. */
export async function signedInContext(browser: Browser, baseURL: string, account: Account): Promise<BrowserContext> {
  const api = await loginApi(baseURL, account.username, account.password)
  const { cookies } = await api.storageState()
  await api.dispose()
  const context = await browser.newContext({ baseURL })
  await context.addCookies(cookies)
  return context
}

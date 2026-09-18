import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { StaffUser } from '@/types/api'
import { authApi } from '@/api/auth'
import { ApiError } from '@/api/errors'

interface AuthValue {
  user: StaffUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<StaffUser>
  logout: () => Promise<void>
  refresh: () => Promise<unknown>
}

const AuthContext = createContext<AuthValue | null>(null)

// Drop every cached query except the auth one: removing the observed query would
// leave useQuery holding a stale result that setQueryData never reaches.
const notAuth = { predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== 'auth' }

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return (await authApi.me()).user
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: Infinity,
    retry: false,
  })

  const login = useCallback(
    async (username: string, password: string) => {
      const { user } = await authApi.login(username, password)
      qc.removeQueries(notAuth)
      qc.setQueryData(['auth', 'me'], user)
      return user
    },
    [qc],
  )

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      qc.removeQueries(notAuth)
      qc.setQueryData(['auth', 'me'], null)
    }
  }, [qc])

  const value = useMemo<AuthValue>(
    () => ({ user: me.data ?? null, loading: me.isPending, login, logout, refresh: () => me.refetch() }),
    [me, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

/** For pages that only render once signed in. */
export function useUser(): StaffUser {
  const { user } = useAuth()
  if (!user) throw new Error('useUser without a signed-in user')
  return user
}

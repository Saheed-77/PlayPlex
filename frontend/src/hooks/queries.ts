import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Floor } from '@/types/api'
import { floorApi } from '@/api/floor'
import { plansApi } from '@/api/admin'
import { friendlyMessage } from '@/api/errors'

// Query keys in one place, so live events know what to invalidate.
export const qk = {
  floor: ['floor'] as const,
  queue: (typeId: number | null, q: string) => ['queue', typeId, q] as const,
  plans: ['plans'] as const,
  adminPlans: ['admin', 'plans'] as const,
  tickets: (params: object) => ['tickets', params] as const,
  ticket: (id: number) => ['tickets', 'detail', id] as const,
  students: (q: string) => ['students', q] as const,
  adminDevices: ['admin', 'devices'] as const,
  deviceTypes: ['admin', 'device-types'] as const,
  staff: ['admin', 'staff'] as const,
  settings: ['admin', 'settings'] as const,
  audit: (params: object) => ['admin', 'audit', params] as const,
  report: (name: string, params: object) => ['admin', 'reports', name, params] as const,
  mySessions: ['sessions', 'mine'] as const,
  shift: ['shift'] as const,
}

/** GET /api/floor. Live events and LiveProvider's polling fallback keep it fresh. */
export function useFloor() {
  return useQuery<Floor>({ queryKey: qk.floor, queryFn: floorApi.get, staleTime: 30_000 })
}

export function usePlans() {
  return useQuery({ queryKey: qk.plans, queryFn: plansApi.active, staleTime: 60_000 })
}

/**
 * A mutation that toasts a friendly message on failure and refreshes the given
 * queries on success. Components add their own success feedback.
 */
export function useApiMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  opts: { invalidate?: QueryKey[]; onSuccess?: (data: TData, vars: TVars) => void; onError?: (err: unknown, vars: TVars) => boolean | void } = {},
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      for (const key of opts.invalidate ?? [qk.floor]) qc.invalidateQueries({ queryKey: key })
      opts.onSuccess?.(data, vars)
    },
    onError: (err, vars) => {
      // A handler can return true to say "I've shown this one myself".
      if (opts.onError?.(err, vars) === true) return
      toast.error(friendlyMessage(err))
    },
  })
}

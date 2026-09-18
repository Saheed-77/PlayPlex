import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { uuid } from '@/lib/utils'

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

/**
 * Generated when the form mounts, regenerated after a success, so a double-click can
 * never double-charge (docs/05 R2).
 */
export function useIdempotencyKey(): [string, () => void] {
  const [key, setKey] = useState(uuid)
  const rotate = useCallback(() => setKey(uuid()), [])
  return [key, rotate]
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
  )
}

export const useIsPhone = () => !useMediaQuery('(min-width: 640px)')

/** A localStorage-backed preference. Always falls back to the default. */
export function useStoredState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        /* ignore */
      }
    },
    [key],
  )
  return [value, set]
}

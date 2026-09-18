import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { serverClock } from '@/api/client'

// One ticker for the whole app (docs/05 V1). Every countdown reads this value;
// nothing starts its own interval.
const NowContext = createContext<number>(Date.now())

export function ClockProvider({ children, intervalMs = 1000 }: { children: ReactNode; intervalMs?: number }) {
  const [now, setNow] = useState(() => serverClock.now())
  useEffect(() => {
    const id = setInterval(() => setNow(serverClock.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>
}

/** Skew-corrected "now" in epoch ms, updated once per tick. */
export function useServerNow(): number {
  return useContext(NowContext)
}

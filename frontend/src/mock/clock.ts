// The demo backend's clock. It can run faster than real time so a 30-minute session
// turns amber and then red while you watch. Shared across tabs via localStorage.

interface ClockState {
  anchorReal: number
  anchorDemo: number
  speed: number
}

const KEY = 'ppx.mock.clock'
const listeners = new Set<() => void>()

function read(): ClockState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as ClockState
  } catch {
    /* storage unavailable: fall through to real time */
  }
  const now = Date.now()
  return { anchorReal: now, anchorDemo: now, speed: 1 }
}

let state = read()

function write(next: ClockState) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* non-persistent is fine */
  }
  listeners.forEach((l) => l())
}

window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    state = read()
    listeners.forEach((l) => l())
  }
})

export const demoClock = {
  now(): number {
    return state.anchorDemo + (Date.now() - state.anchorReal) * state.speed
  },
  speed(): number {
    return state.speed
  },
  setSpeed(speed: number) {
    const now = Date.now()
    write({ anchorReal: now, anchorDemo: this.now(), speed })
  },
  /** Jump the demo clock forward, e.g. to push a session into overdue. */
  advance(ms: number) {
    const now = Date.now()
    write({ anchorReal: now, anchorDemo: this.now() + ms, speed: state.speed })
  },
  reset() {
    const now = Date.now()
    write({ anchorReal: now, anchorDemo: now, speed: 1 })
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

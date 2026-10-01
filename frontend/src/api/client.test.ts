import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The clock the whole app counts down from (docs/02 §4.1, docs/07 task 6.5).
 *
 * A borrowed tablet with a wrong clock is not a hypothetical — it is the normal state of a
 * device that has been in a drawer since last term. Left uncorrected, one ten-minutes-fast
 * tablet ends every session it touches ten minutes early, all evening, and the board looks
 * entirely normal while it happens. Nobody would report it as a bug; they would report that
 * the games felt short.
 *
 * `serverClock` holds the offset between this device and the server, taken from the
 * `X-Server-Time` header on every response. These tests pose as a device with a wrong
 * clock and check the offset actually wins.
 */

/** The truth, as the server tells it. */
const SERVER_NOW = Date.parse('2026-09-14T09:00:00Z')

/** Module state is a singleton, so each test gets a fresh copy of it. */
async function freshClock() {
  vi.resetModules()
  return (await import('./client')).serverClock
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('serverClock', () => {
  it('corrects a device that is ten minutes fast', async () => {
    vi.setSystemTime(SERVER_NOW + 10 * 60_000)
    const clock = await freshClock()

    expect(clock.now()).toBe(SERVER_NOW + 10 * 60_000)
    clock.observe(new Date(SERVER_NOW).toISOString())
    expect(clock.now()).toBe(SERVER_NOW)
  })

  it('corrects a device that is ten minutes slow', async () => {
    vi.setSystemTime(SERVER_NOW - 10 * 60_000)
    const clock = await freshClock()

    clock.observe(new Date(SERVER_NOW).toISOString())
    expect(clock.now()).toBe(SERVER_NOW)
  })

  it('keeps ticking forward between responses', async () => {
    vi.setSystemTime(SERVER_NOW + 10 * 60_000)
    const clock = await freshClock()
    clock.observe(new Date(SERVER_NOW).toISOString())

    // No response for half a minute; the countdown must not freeze.
    vi.advanceTimersByTime(30_000)
    expect(clock.now()).toBe(SERVER_NOW + 30_000)
  })

  it('re-reads the offset on every response, so a device that drifts is re-corrected', async () => {
    vi.setSystemTime(SERVER_NOW)
    const clock = await freshClock()
    clock.observe(new Date(SERVER_NOW).toISOString())
    expect(clock.now()).toBe(SERVER_NOW)

    // The tablet's clock jumps — an NTP sync, or someone in Settings.
    vi.setSystemTime(SERVER_NOW + 3 * 60_000)
    clock.observe(new Date(SERVER_NOW).toISOString())
    expect(clock.now()).toBe(SERVER_NOW)
  })

  it('leaves a known offset alone when a response carries no usable time', async () => {
    vi.setSystemTime(SERVER_NOW + 10 * 60_000)
    const clock = await freshClock()
    clock.observe(new Date(SERVER_NOW).toISOString())

    // A 204, a CSV download, a proxy that ate the header: none of these are evidence that
    // the device was right all along, so the correction has to survive them.
    clock.observe(null)
    expect(clock.now()).toBe(SERVER_NOW)
    clock.observe('not a timestamp')
    expect(clock.now()).toBe(SERVER_NOW)
  })

  it('stands aside for the demo backend, which runs its own clock', async () => {
    vi.setSystemTime(SERVER_NOW)
    const clock = await freshClock()

    // The demo can run at 60× to show a countdown going amber. Skew correction would drag
    // it back to wall time on the next response and undo the whole illusion.
    let demoTime = Date.parse('2030-01-01T00:00:00Z')
    clock.useSource(() => demoTime)

    clock.observe(new Date(SERVER_NOW).toISOString())
    expect(clock.now()).toBe(demoTime)

    demoTime += 60 * 60_000
    expect(clock.now()).toBe(demoTime)
  })
})

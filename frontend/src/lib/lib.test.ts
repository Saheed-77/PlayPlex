import { beforeEach, describe, expect, it } from 'vitest'
import { demoPanelEnabled } from './demoFlag'
import { deriveState, sortByUrgency } from './deviceState'
import { formatPaise, parseRupees } from './money'
import { formatDuration } from './time'
import { extensionPricePaise } from './pricing'
import type { DeviceStatus, Plan } from '@/types/api'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const WARN = 5 * 60_000
const device = (code: string, status: DeviceStatus, endsInMs?: number, pausedAtMs?: number) => ({
  code,
  status,
  session:
    endsInMs === undefined
      ? null
      : {
          plannedEndAt: new Date(NOW + endsInMs).toISOString(),
          pausedAt: pausedAtMs === undefined ? null : new Date(NOW + pausedAtMs).toISOString(),
        },
})

describe('deriveState', () => {
  it('derives running, ending soon and overdue from plannedEndAt alone', () => {
    expect(deriveState(device('A', 'IN_USE', 10 * 60_000), NOW, WARN).state).toBe('RUNNING')
    expect(deriveState(device('A', 'IN_USE', 4 * 60_000), NOW, WARN).state).toBe('ENDING_SOON')
    const over = deriveState(device('A', 'IN_USE', -200_000), NOW, WARN)
    expect(over.state).toBe('OVERDUE')
    expect(over.remainingMs).toBe(-200_000)
  })

  it('freezes the countdown while paused, whatever the clock does', () => {
    // Paused one minute ago with 10 minutes left.
    const paused = device('A', 'IN_USE', 9 * 60_000, -60_000)
    const atPause = deriveState(paused, NOW, WARN)
    expect(atPause.state).toBe('PAUSED')
    expect(atPause.remainingMs).toBe(10 * 60_000)
    expect(atPause.pausedForMs).toBe(60_000)

    // Five minutes later the held time is unchanged; only the pause has grown.
    const later = deriveState(paused, NOW + 5 * 60_000, WARN)
    expect(later.remainingMs).toBe(10 * 60_000)
    expect(later.pausedForMs).toBe(6 * 60_000)
  })

  it('stays paused even once the original end time has passed', () => {
    const paused = device('A', 'IN_USE', 60_000, -30_000)
    expect(deriveState(paused, NOW + 10 * 60_000, WARN).state).toBe('PAUSED')
  })

  it('reads the same on a tablet ten minutes fast, because the clock is corrected first', () => {
    const ending = device('A', 'IN_USE', 4 * 60_000)

    // What a wrong device clock would say on its own: four minutes in the past, so the
    // volunteer sees a red overdue card and ends a session with four minutes left on it.
    expect(deriveState(ending, NOW + 10 * 60_000, WARN).state).toBe('OVERDUE')

    // What it actually gets, because every countdown reads the skew-corrected value from
    // `serverClock` through the single ticker in hooks/useServerNow (docs/05 V1).
    const corrected = deriveState(ending, NOW, WARN)
    expect(corrected.state).toBe('ENDING_SOON')
    expect(corrected.remainingMs).toBe(4 * 60_000)
  })

  it('maps the non-session statuses', () => {
    expect(deriveState(device('A', 'AVAILABLE'), NOW, WARN).state).toBe('FREE')
    expect(deriveState(device('A', 'CLEANING'), NOW, WARN).state).toBe('CLEANING')
    expect(deriveState(device('A', 'OUT_OF_SERVICE'), NOW, WARN).state).toBe('OUT')
  })
})

describe('sortByUrgency', () => {
  it('orders overdue, ending soon, free, running, cleaning, out of service', () => {
    const sorted = sortByUrgency(
      [
        device('OUT', 'OUT_OF_SERVICE'),
        device('RUN', 'IN_USE', 20 * 60_000),
        device('CLEAN', 'CLEANING'),
        device('FREE', 'AVAILABLE'),
        device('SOON', 'IN_USE', 60_000),
        device('LATE-1', 'IN_USE', -60_000),
        device('LATE-2', 'IN_USE', -300_000),
      ],
      NOW,
      WARN,
    )
    expect(sorted.map((d) => d.code)).toEqual(['LATE-2', 'LATE-1', 'SOON', 'FREE', 'RUN', 'CLEAN', 'OUT'])
  })

  it('puts a paused station just behind overdue: it is idle while people wait', () => {
    const sorted = sortByUrgency(
      [device('RUN', 'IN_USE', 20 * 60_000), device('SOON', 'IN_USE', 60_000), device('HELD', 'IN_USE', 9 * 60_000, -60_000), device('LATE', 'IN_USE', -60_000)],
      NOW,
      WARN,
    )
    expect(sorted.map((d) => d.code)).toEqual(['LATE', 'HELD', 'SOON', 'RUN'])
  })
})

describe('money', () => {
  it('formats integer paise as rupees', () => {
    expect(formatPaise(5000)).toBe('₹50')
    expect(formatPaise(912000)).toBe('₹9,120')
    expect(formatPaise(-15000)).toBe('-₹150')
    expect(formatPaise(5050)).toBe('₹50.5')
  })

  it('parses rupee input without floating point', () => {
    expect(parseRupees('50')).toBe(5000)
    expect(parseRupees('0.1')).toBe(10)
    expect(parseRupees('19.99')).toBe(1999)
    expect(parseRupees('-5')).toBeNull()
    expect(parseRupees('abc')).toBeNull()
  })
})

describe('formatDuration', () => {
  it('pads minutes and seconds and adds hours when needed', () => {
    expect(formatDuration(754_000)).toBe('12:34')
    expect(formatDuration(3_754_000)).toBe('1:02:34')
    expect(formatDuration(-5)).toBe('00:00')
  })
})

describe('extensionPricePaise', () => {
  const plan = (id: number, durationMinutes: number, pricePaise: number, deviceTypeIds: number[] = []): Plan => ({
    id, name: `P${id}`, durationMinutes, pricePaise, description: '', sortOrder: id, active: true, deviceTypeIds, seatsPerTicket: 1,
  })
  const plans = [plan(1, 15, 3000), plan(2, 30, 5000), plan(3, 15, 5000, [3])]

  it('uses the most specific plan with that duration', () => {
    expect(extensionPricePaise(plans, 4, 15)).toBe(3000)
    expect(extensionPricePaise(plans, 3, 15)).toBe(5000)
    expect(extensionPricePaise(plans, 4, 30)).toBe(5000)
  })
})

describe('demoPanelEnabled', () => {
  beforeEach(() => sessionStorage.clear())

  it('is off unless the query asks for it', () => {
    expect(demoPanelEnabled('')).toBe(false)
    expect(demoPanelEnabled('?demo=1')).toBe(true)
    expect(demoPanelEnabled('?foo=bar&demo=yes')).toBe(true)
  })

  it('sticks for the tab once enabled, so in-app navigation keeps it', () => {
    demoPanelEnabled('?demo=1')
    expect(demoPanelEnabled('')).toBe(true)
    expect(demoPanelEnabled('?other=1')).toBe(true)
  })

  it('can be switched back off', () => {
    demoPanelEnabled('?demo=1')
    expect(demoPanelEnabled('?demo=0')).toBe(false)
    expect(demoPanelEnabled('')).toBe(false)
  })
})

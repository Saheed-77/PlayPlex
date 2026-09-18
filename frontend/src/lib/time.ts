// Timestamps travel as UTC ISO-8601; display is Asia/Kolkata (docs README).
export const DISPLAY_TZ = 'Asia/Kolkata'

const clock = new Intl.DateTimeFormat('en-IN', { timeZone: DISPLAY_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
const dateTime = new Intl.DateTimeFormat('en-IN', { timeZone: DISPLAY_TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
const hourOnly = new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_TZ, hour: 'numeric', hour12: true })
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

type DateInput = string | number | Date

export const formatClock = (d: DateInput) => clock.format(new Date(d))
export const formatDateTime = (d: DateInput) => dateTime.format(new Date(d))
export const formatHour = (d: DateInput) => hourOnly.format(new Date(d)).replace(' ', '').toLowerCase()
/** YYYY-MM-DD in the display timezone. */
export const localDay = (d: DateInput) => dayFmt.format(new Date(d))

/** 754_000 → "12:34"; 3_754_000 → "1:02:34". Always non-negative. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function minutesBetween(from: DateInput, to: DateInput): number {
  return Math.max(0, Math.round((+new Date(to) - +new Date(from)) / 60_000))
}

export function formatMinutes(min: number): string {
  if (min <= 0) return 'now'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

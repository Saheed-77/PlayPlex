// Money is integer paise everywhere (ADR-003). Format only at the edge.
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })

export function formatPaise(paise: number, opts: { sign?: boolean } = {}): string {
  const negative = paise < 0
  const body = `₹${inr.format(Math.abs(paise) / 100)}`
  if (negative) return `-${body}`
  return opts.sign && paise > 0 ? `+${body}` : body
}

/** "50" or "50.5" → paise. Returns null for anything that isn't a non-negative amount. */
export function parseRupees(input: string): number | null {
  const trimmed = input.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, frac = ''] = trimmed.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}

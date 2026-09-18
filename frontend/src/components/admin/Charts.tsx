import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'

// Two single-series charts only (docs/05 A1): one hue, no legend (the title names
// the series), recessive grid, 4px rounded data ends, hover tooltip on every bar.

const AXIS = { stroke: 'var(--color-muted-foreground)', fontSize: 12, tickLine: false, axisLine: false } as const

function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: { value: number }[]; label?: string; format: (v: number) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{format(payload[0].value)}</p>
    </div>
  )
}

export function ColumnChart({ data, format, height = 220, ariaLabel }: { data: { label: string; value: number }[]; format: (v: number) => string; height?: number; ariaLabel: string }) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -16 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="0" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
          <YAxis {...AXIS} allowDecimals={false} width={48} />
          <Tooltip cursor={{ fill: 'var(--color-muted)', opacity: 0.6 }} content={<ChartTooltip format={format} />} />
          <Bar dataKey="value" fill="var(--color-series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function HorizontalBarChart({ data, format, ariaLabel }: { data: { label: string; value: number }[]; format: (v: number) => string; ariaLabel: string }) {
  const height = Math.max(120, data.length * 40 + 16)
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 0 }} barCategoryGap={8}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" {...AXIS} width={56} />
          <Tooltip cursor={{ fill: 'var(--color-muted)', opacity: 0.6 }} content={<ChartTooltip format={format} />} />
          <Bar dataKey="value" fill="var(--color-series-1)" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
            <LabelList dataKey="value" position="right" formatter={(v: unknown) => format(Number(v))} className="fill-foreground text-xs font-semibold" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function KpiTile({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'over' | 'soon' | 'free'; icon?: ReactNode }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', tone === 'over' && 'border-over/50', tone === 'soon' && 'border-soon/50')}>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-3xl font-black tabular-nums tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

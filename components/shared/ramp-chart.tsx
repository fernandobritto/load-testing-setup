'use client'

import { useId } from 'react'
import type { ExecutorConfig } from '@/lib/dsl/types'
import { loadProfile } from '@/lib/k6/load-profile'
import { formatDuration } from '@/lib/utils'

/**
 * A compact, theme-aware SVG area chart of load over time — teaches the shape
 * of the executor at a glance (ramp up / plateau / ramp down).
 *
 * `color` accents the chart with the scenario type's hue, so a card and its
 * chart read as one object.
 */
export function RampChart({
  config,
  height = 96,
  color = 'var(--primary)'
}: {
  config: ExecutorConfig
  height?: number
  color?: string
}): React.ReactNode {
  const gradientId = useId()
  const { points, unit } = loadProfile(config)
  const width = 320
  const padding = { top: 10, right: 8, bottom: 18, left: 8 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const maxT = Math.max(...points.map((p) => p.t), 1)
  const maxV = Math.max(...points.map((p) => p.v), 1)

  const x = (t: number): number => padding.left + (t / maxT) * innerW
  const y = (v: number): number => padding.top + innerH - (v / maxV) * innerH

  const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const area = `${padding.left},${padding.top + innerH} ${line} ${x(maxT).toFixed(1)},${padding.top + innerH}`

  return (
    <div className='rounded-md border border-border bg-muted/40 p-2'>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className='w-full'
        role='img'
        aria-label={`Load profile peaking at ${maxV} ${unit} over ${formatDuration(maxT)}`}
      >
        <defs>
          <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={color} stopOpacity='0.35' />
            <stop offset='100%' stopColor={color} stopOpacity='0.02' />
          </linearGradient>
        </defs>
        {/* baseline */}
        <line
          x1={padding.left}
          y1={padding.top + innerH}
          x2={width - padding.right}
          y2={padding.top + innerH}
          stroke='var(--border)'
          strokeWidth='1'
        />
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill='none'
          stroke={color}
          strokeWidth='2'
          strokeLinejoin='round'
          strokeLinecap='round'
        />
        {points.map((p, index) => (
          <circle key={index} cx={x(p.t)} cy={y(p.v)} r='2.5' fill={color} />
        ))}
      </svg>
      <div className='flex justify-between px-1 text-[10px] text-muted-foreground'>
        <span>
          peak <span className='font-semibold text-foreground'>{maxV}</span> {unit}
        </span>
        <span>{formatDuration(maxT)} total</span>
      </div>
    </div>
  )
}

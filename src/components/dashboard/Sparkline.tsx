// src/components/dashboard/Sparkline.tsx
//
// Tiny inline-SVG sparkline. We deliberately do NOT pull recharts (the
// plan's open-question #1 pre-approved this stdlib fallback): a single
// path with auto-scaled Y and equispaced X covers every dashboard card
// in this iteration. When the metric series justifies axis labels or
// hover tooltips, swap to recharts at that point — the consumer surface
// (`<Sparkline values={...} />`) is compatible with a recharts
// LineChart that takes a `data` array.

import React, { useId } from 'react'
import styled from 'styled-components'

const SVG = styled.svg`
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
`

export interface SparklineProps {
  values: ReadonlyArray<number>
  // Optional explicit range; otherwise derived from values. Providing
  // a fixed range keeps a series with one stuck value (all zeros) from
  // collapsing to a flat line at the middle of the canvas.
  minY?: number
  maxY?: number
  // CSS color for the stroke. Defaults to the Bootstrap link color so
  // the spark line inherits theme dark/light without a per-card prop.
  stroke?: string
  // CSS height as a number — caller-controlled because parent layouts
  // (numeric chip + spark side-by-side) usually want a fixed pixel
  // height.
  height?: number
  ariaLabel?: string
  'data-testid'?: string
}

export const Sparkline: React.FC<SparklineProps> = ({
  values,
  minY,
  maxY,
  stroke = 'var(--bs-link-color, currentColor)',
  height = 36,
  ariaLabel,
  'data-testid': dataTestId,
}) => {
  const titleId = useId()
  // Defensive: an empty series renders an empty <svg> with the same
  // dimensions so the parent layout doesn't reflow when the first
  // sample lands.
  if (values.length === 0) {
    return (
      <SVG
        role="img"
        aria-labelledby={titleId}
        data-testid={dataTestId}
        style={{ height }}
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
      >
        <title id={titleId}>{ariaLabel ?? 'No data yet'}</title>
      </SVG>
    )
  }

  const lo = minY ?? Math.min(...values)
  const hi = maxY ?? Math.max(...values)
  // Avoid divide-by-zero when every sample is identical; render a flat
  // line at vertical center.
  const span = hi - lo || 1
  const step = values.length > 1 ? 100 / (values.length - 1) : 0
  const points = values.map((v, i) => {
    const x = i * step
    // Invert Y so larger values appear higher.
    const y = 24 - ((v - lo) / span) * 24
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const d = `M ${points.join(' L ')}`

  return (
    <SVG
      role="img"
      aria-labelledby={titleId}
      data-testid={dataTestId}
      style={{ height }}
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
    >
      <title id={titleId}>
        {ariaLabel ?? `Sparkline (${values.length} samples)`}
      </title>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" />
    </SVG>
  )
}

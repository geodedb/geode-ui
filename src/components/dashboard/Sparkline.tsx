// src/components/dashboard/Sparkline.tsx
//
// Recharts-backed sparkline. Wraps Recharts' ResponsiveContainer +
// LineChart with the project's color tokens and a minimal API
// (`<Sparkline values={[...]} />`) so dashboard cards don't repeat
// the boilerplate. Hover tooltip surfaces the per-sample value; the
// Y-axis is auto-scaled but hidden so the spark stays a spark (a
// numeric chip beside the sparkline already shows the exact latest
// value).
//
// Why Recharts: tooltips + correct hover hit-testing + dark-mode
// theming via CSS vars come "for free", and the bundle delta is ~80
// KB gzipped against an app that already ships Monaco + Cytoscape.

import React, { useId } from 'react'
import styled from 'styled-components'
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'

const Wrapper = styled.div<{ $h: number }>`
  width: 100%;
  height: ${({ $h }) => $h}px;
  /* Recharts wraps its SVG in a position:relative <div>; make sure
     our wrapper carries the same positioning context so the tooltip
     anchors against the chart area, not the page. */
  position: relative;
`

export interface SparklineProps {
  values: ReadonlyArray<number>
  // Stroke color override. Defaults to the Bootstrap link color so the
  // spark inherits theme dark/light without a per-card prop.
  stroke?: string
  // Pixel height — caller-controlled because parent layouts (numeric
  // chip + spark side-by-side) usually want a fixed height.
  height?: number
  // Number formatter for the hover tooltip; defaults to 2 fractional
  // digits, which is right for QPS / fractional gauges.
  formatValue?: (v: number) => string
  ariaLabel?: string
  'data-testid'?: string
}

interface ChartDatum {
  i: number
  v: number
}

function buildData(values: ReadonlyArray<number>): ChartDatum[] {
  return values.map((v, i) => ({ i, v }))
}

const defaultFormat = (v: number): string => v.toFixed(2)

// formatForTooltip and emptyLabel hoist the Recharts Tooltip formatter
// callbacks out of the render body. Keeping them at module scope (or
// returned from a factory called once per Sparkline mount) keeps the
// JSX tidy and stops the prettier/eslint formatting fight that fires
// when a multi-line arrow lives directly inside a prop value.
function formatForTooltip(
  formatValue: (v: number) => string
): (value: number | string) => [string, string] {
  return (value) => {
    if (typeof value === 'number') return [formatValue(value), '']
    return [String(value), '']
  }
}
const emptyLabel = (): string => ''

export const Sparkline: React.FC<SparklineProps> = ({
  values,
  stroke = 'var(--bs-link-color, currentColor)',
  height = 36,
  formatValue = defaultFormat,
  ariaLabel,
  'data-testid': dataTestId,
}) => {
  const titleId = useId()
  // Empty-series branch: render an empty wrapper at the same height so
  // the parent's layout doesn't reflow when the first sample lands.
  if (values.length === 0) {
    return (
      <Wrapper $h={height} data-testid={dataTestId} aria-labelledby={titleId}>
        <span id={titleId} className="visually-hidden">
          {ariaLabel ?? 'No samples yet'}
        </span>
      </Wrapper>
    )
  }
  const data = buildData(values)
  return (
    <Wrapper $h={height} data-testid={dataTestId} aria-labelledby={titleId}>
      <span id={titleId} className="visually-hidden">
        {ariaLabel ?? `Sparkline (${values.length} samples)`}
      </span>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
        >
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            cursor={false}
            isAnimationActive={false}
            formatter={formatForTooltip(formatValue)}
            // Hide the series-name column — the spark already encodes
            // one series, so the tooltip is just the formatted value.
            labelFormatter={emptyLabel}
            wrapperStyle={{ outline: 'none' }}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Wrapper>
  )
}

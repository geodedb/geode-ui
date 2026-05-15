export type Tier = 'small' | 'mid' | 'large'

type Result = { measure: PerformanceMeasure | null }

function safeMark(name: string): void {
  try {
    performance.mark(name)
  } catch {
    /* mark API unavailable (jsdom corner / hardened env); silently drop */
  }
}

function safeMeasure(
  name: string,
  start: string,
  end: string
): PerformanceMeasure | null {
  try {
    return performance.measure(name, start, end)
  } catch {
    return null
  }
}

export const perfMarks = {
  start(name: string): void {
    safeMark(`${name}:start`)
  },
  end(name: string): Result {
    safeMark(`${name}:end`)
    const measure = safeMeasure(name, `${name}:start`, `${name}:end`)
    return { measure }
  },
  tier(t: Tier): void {
    safeMark(`graph:tier:${t}`)
  },
}

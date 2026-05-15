export type Tier = 'small' | 'mid' | 'large'

type Result = { measure: PerformanceMeasure | null }

const MAX_BUFFER = 512

let buffer: PerformanceMeasure[] = []
let observer: PerformanceObserver | null = null
let endpoint: string | null = null

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

function push(m: PerformanceMeasure): void {
  buffer.push(m)
  if (buffer.length > MAX_BUFFER) {
    // LRU drop: keep the newest MAX_BUFFER entries, discard the oldest
    // overflow so observers under load can't grow unbounded.
    buffer = buffer.slice(buffer.length - MAX_BUFFER)
  }
}

function startObserver(uploadUrl: string): void {
  if (observer) return
  endpoint = uploadUrl
  try {
    observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => {
        if (e.entryType === 'measure') push(e as PerformanceMeasure)
      })
    })
    observer.observe({ entryTypes: ['measure'] })
  } catch {
    // PerformanceObserver unavailable (jsdom corner / hardened env);
    // silently disable. Direct __pushMeasureForTest() callers still work.
    observer = null
  }
}

async function flush(): Promise<void> {
  if (!endpoint || buffer.length === 0) return
  const batch = buffer
  buffer = []
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        measures: batch.map((m) => ({
          name: m.name,
          startTime: m.startTime,
          duration: m.duration,
        })),
      }),
    })
  } catch {
    /* best-effort: telemetry must never surface to the user */
  }
}

/* eslint-disable no-underscore-dangle -- internal __-prefixed test seams */
export const perfMarks = {
  start(name: string): void {
    safeMark(`${name}:start`)
  },
  end(name: string): Result {
    safeMark(`${name}:end`)
    return { measure: safeMeasure(name, `${name}:start`, `${name}:end`) }
  },
  tier(t: Tier): void {
    safeMark(`graph:tier:${t}`)
  },
  flush,
  /** @internal — test seam */
  __startObserver: startObserver,
  /** @internal — test seam */
  __bufferSizeForTest(): number {
    return buffer.length
  },
  /** @internal — test seam */
  __pushMeasureForTest(m: PerformanceMeasure): void {
    push(m)
  },
  /** @internal — test seam */
  __resetForTest(): void {
    buffer = []
    observer?.disconnect()
    observer = null
    endpoint = null
  },
}
/* eslint-enable no-underscore-dangle */

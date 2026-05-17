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

// PERF-N5 (#284): module-level counter so tests can assert longtask
// observation actually fires without coupling to console.warn (which
// other tests routinely silence). Exposed via __longTaskCountForTest.
let longTaskCount = 0
let longTaskObserver: PerformanceObserver | null = null

// reportLongTask emits a development-only warning when a long task
// (>50ms blocked the main thread, per spec) is observed. We deliberately
// gate the console.warn on `process.env.NODE_ENV !== 'production'` so
// production users do not see telemetry spew; a future hook can plug a
// production dispatcher (e.g. push to a metrics endpoint) into this
// seam.
function reportLongTask(entry: PerformanceEntry): void {
  longTaskCount += 1
  /* istanbul ignore next -- env-gated branch */
  if (
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NODE_ENV !== 'production'
  ) {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[perfMarks] longtask blocked main thread for ${entry.duration.toFixed(1)}ms`,
        { name: entry.name, startTime: entry.startTime }
      )
    } catch {
      /* console may be unavailable in hardened envs */
    }
  }
}

function startObserver(uploadUrl: string): void {
  if (observer) return
  try {
    observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => {
        if (e.entryType === 'measure') push(e as PerformanceMeasure)
      })
    })
    observer.observe({ entryTypes: ['measure'] })
    endpoint = uploadUrl
  } catch {
    // PerformanceObserver unavailable (jsdom corner / hardened env);
    // silently disable. endpoint stays null so flush() is a no-op.
    observer = null
    endpoint = null
  }

  // PERF-N5 (#284): also observe `longtask` so >50ms main-thread
  // blocks surface in development. The observer is a SEPARATE
  // PerformanceObserver instance because the spec forbids mixing
  // `entryTypes` (a deprecated init shape) with `type` (the modern
  // shape), and `longtask` is delivered through the buffered-entry-
  // type path which doesn't compose well with the `measure` observer's
  // dispatch model. Failing to install is silent — `longtask` is not
  // a supported entryType in jsdom, node's perf_hooks, or older
  // browsers; the development warning is best-effort, not load-bearing.
  if (longTaskObserver) return
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => {
        if (e.entryType === 'longtask') reportLongTask(e)
      })
    })
    longTaskObserver.observe({ type: 'longtask', buffered: true })
  } catch {
    longTaskObserver = null
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
    longTaskObserver?.disconnect()
    longTaskObserver = null
    longTaskCount = 0
    endpoint = null
  },
  /** @internal — test seam (PERF-N5 #284) */
  __longTaskCountForTest(): number {
    return longTaskCount
  },
  /** @internal — test seam (PERF-N5 #284). Simulates a longtask
   * delivery by feeding a synthetic entry through the reporter.
   * Production code never calls this. */
  __reportLongTaskForTest(entry: PerformanceEntry): void {
    reportLongTask(entry)
  },
  /** @internal — test seam (PERF-N5 #284) */
  __hasLongTaskObserverForTest(): boolean {
    return longTaskObserver !== null
  },
}
/* eslint-enable no-underscore-dangle */

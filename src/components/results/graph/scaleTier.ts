export type Tier = 'small' | 'mid' | 'large'

const SMALL_MAX = 2_000
const MID_MAX = 5_000
const HYSTERESIS = 100

function rawTier(n: number): Tier {
  if (n >= MID_MAX) return 'large'
  if (n >= SMALL_MAX) return 'mid'
  return 'small'
}

// Hysteresis: when transitioning DOWN across a boundary, demand at least
// HYSTERESIS nodes below the boundary before flipping. UP-transitions
// fire at the hard boundary (no hysteresis on the way up).
export function scaleTier(n: number, prev?: Tier): Tier {
  const raw = rawTier(n)
  if (!prev || raw === prev) return raw

  if (prev === 'mid' && raw === 'small') {
    return n <= SMALL_MAX - HYSTERESIS ? 'small' : 'mid'
  }
  if (prev === 'large' && raw === 'mid') {
    return n <= MID_MAX - HYSTERESIS ? 'mid' : 'large'
  }
  return raw
}

export interface FeatureAllowList {
  domNodes: boolean
  cxtmenu: boolean
  tooltips: boolean
  badges: boolean
}

export function allowedFeatures(t: Tier): FeatureAllowList {
  switch (t) {
    case 'small':
      return { domNodes: true, cxtmenu: true, tooltips: true, badges: true }
    case 'mid':
      return { domNodes: false, cxtmenu: true, tooltips: true, badges: true }
    default:
      return { domNodes: false, cxtmenu: false, tooltips: false, badges: false }
  }
}

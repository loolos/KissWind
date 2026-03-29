import { normalizeAngle } from './Physics'
import { DEFAULT_ROUTE_MAP } from './mapConfig'

export interface WindAnchorPoint {
  id: string
  label: string
  worldX: number
  worldY: number
  direction: number
  strength: number
}

export interface FixedRouteMap {
  id: string
  label: string
  start: { worldX: number; worldY: number }
  finish: { worldX: number; worldY: number; radius: number }
  windAnchors: WindAnchorPoint[]
}

export interface WindDirectionRandomizationOptions {
  /** Max absolute angular offset from anchor→finish direction (radians). */
  maxDeviationRad: number
}

/** Canonical default course (from `mapConfig`); same geometry & anchor winds every run unless you swap maps. */
export const FIXED_ROUTE_MAP: FixedRouteMap = DEFAULT_ROUTE_MAP

function randRange(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  return dx * dx + dy * dy
}

export interface GenerateRandomRouteMapOptions {
  /** Number of wind anchors (clamped 3–8). Default 5. */
  anchorCount?: number
  /** Minimum distance start ↔ finish. Default 850. */
  minStartFinishSeparation?: number
  /** Minimum distance between anchors and from start/finish. Default 180. */
  minPointSeparation?: number
  finishRadius?: number
}

const RAND_WORLD = {
  xMin: -650,
  xMax: 650,
  yMin: -450,
  yMax: 480,
} as const

/**
 * Procedural course: random start (west-ish), finish (east-ish), scattered wind anchors.
 * Each run gets a new `id` so best-time keys stay separate from the default map.
 */
export function generateRandomRouteMap(options: GenerateRandomRouteMapOptions = {}): FixedRouteMap {
  const anchorCount = Math.max(3, Math.min(8, options.anchorCount ?? 5))
  const minSF = options.minStartFinishSeparation ?? 850
  const minSep = options.minPointSeparation ?? 180
  const minSep2 = minSep * minSep
  const finishRadius = options.finishRadius ?? 36

  let start = { worldX: 0, worldY: 0 }
  let finish = { worldX: 0, worldY: 0, radius: finishRadius }
  for (let i = 0; i < 100; i++) {
    start = {
      worldX: randRange(RAND_WORLD.xMin, -120),
      worldY: randRange(RAND_WORLD.yMin, RAND_WORLD.yMax),
    }
    finish = {
      worldX: randRange(120, RAND_WORLD.xMax),
      worldY: randRange(RAND_WORLD.yMin, RAND_WORLD.yMax),
      radius: finishRadius,
    }
    if (dist2(start.worldX, start.worldY, finish.worldX, finish.worldY) >= minSF * minSF) break
  }

  const occupied: { x: number; y: number }[] = [
    { x: start.worldX, y: start.worldY },
    { x: finish.worldX, y: finish.worldY },
  ]

  const windAnchors: WindAnchorPoint[] = []
  let guard = 0
  while (windAnchors.length < anchorCount && guard < 800) {
    guard++
    const wx = randRange(RAND_WORLD.xMin + 50, RAND_WORLD.xMax - 50)
    const wy = randRange(RAND_WORLD.yMin + 50, RAND_WORLD.yMax - 50)
    let ok = true
    for (const p of occupied) {
      if (dist2(wx, wy, p.x, p.y) < minSep2) {
        ok = false
        break
      }
    }
    if (!ok) continue
    occupied.push({ x: wx, y: wy })
    const toFinish = Math.atan2(finish.worldY - wy, finish.worldX - wx)
    const direction = normalizeAngle(toFinish + randRange(-Math.PI * 0.55, Math.PI * 0.55))
    windAnchors.push({
      id: `w${windAnchors.length + 1}`,
      label: `Sector ${windAnchors.length + 1}`,
      worldX: wx,
      worldY: wy,
      direction,
      strength: randRange(2.4, 3.5),
    })
  }

  return {
    id: `random-${Math.random().toString(36).slice(2, 11)}`,
    label: 'Random course',
    start,
    finish,
    windAnchors,
  }
}

const DEFAULT_WIND_RANDOMIZATION: WindDirectionRandomizationOptions = {
  maxDeviationRad: (Math.PI * 2) / 3, // ±120°
}

/**
 * Build a per-run route map variant where anchor winds are less "goal-seeking":
 * each anchor direction is offset around its anchor→finish bearing by up to ±`maxDeviationRad`.
 */
export function buildRandomizedRouteMap(
  baseMap: FixedRouteMap,
  options: Partial<WindDirectionRandomizationOptions> = {}
): FixedRouteMap {
  const cfg = { ...DEFAULT_WIND_RANDOMIZATION, ...options }
  const { worldX: finishX, worldY: finishY } = baseMap.finish
  return {
    ...baseMap,
    windAnchors: baseMap.windAnchors.map((anchor) => {
      const toFinishDir = Math.atan2(finishY - anchor.worldY, finishX - anchor.worldX)
      const deviation = (Math.random() * 2 - 1) * cfg.maxDeviationRad
      return {
        ...anchor,
        direction: normalizeAngle(toFinishDir + deviation),
      }
    }),
  }
}

export interface FixedMapBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  width: number
  height: number
}

export function getFixedMapBounds(map: FixedRouteMap, padding: number = 40): FixedMapBounds {
  const xs = [map.start.worldX, map.finish.worldX, ...map.windAnchors.map((a) => a.worldX)]
  const ys = [map.start.worldY, map.finish.worldY, ...map.windAnchors.map((a) => a.worldY)]
  const minX = Math.min(...xs) - padding
  const maxX = Math.max(...xs) + padding
  const minY = Math.min(...ys) - padding
  const maxY = Math.max(...ys) + padding
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

/** Normalized distance `u = dist / ANCHOR_FALLOFF`; per-anchor weight `1 / (0.1 + u²)`. */
const ANCHOR_FALLOFF = 520
/** Past this distance from an anchor, it contributes nothing (hard cutoff). */
export const WIND_ANCHOR_MAX_REACH = ANCHOR_FALLOFF * 2

function influenceWeight(dx: number, dy: number): number {
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist >= WIND_ANCHOR_MAX_REACH) return 0
  const u = dist / ANCHOR_FALLOFF
  return 1 / (0.1 + u * u)
}

/** Anchors whose center lies within wind influence range of `(worldX, worldY)`. */
export function windAnchorsWithinReach(
  map: FixedRouteMap,
  worldX: number,
  worldY: number
): WindAnchorPoint[] {
  const r = WIND_ANCHOR_MAX_REACH
  const r2 = r * r
  const out: WindAnchorPoint[] = []
  for (const a of map.windAnchors) {
    const dx = worldX - a.worldX
    const dy = worldY - a.worldY
    if (dx * dx + dy * dy < r2) out.push(a)
  }
  return out
}

const TWO_NEAREST_DIST_EPS = 1e-4

/**
 * Fallback when no in-reach anchors or all influence weights vanish: take the two closest
 * anchors on the map, weight ∝ 1 / max(dist, ε) so nearer dominates, then vector-sum direction
 * and weighted-mean strength (same idea as the main anchor blend).
 */
function blendWindFromTwoNearestAnchors(
  map: FixedRouteMap,
  worldX: number,
  worldY: number,
  elapsedSec: number
): { direction: number; strength: number } {
  const anchors = map.windAnchors
  if (anchors.length === 0) {
    return applyWindWaves(worldX, worldY, elapsedSec, 0, 3)
  }

  let a1: WindAnchorPoint = anchors[0]
  let d1 = Infinity
  let a2: WindAnchorPoint | null = null
  let d2 = Infinity

  for (const a of anchors) {
    const d = Math.hypot(worldX - a.worldX, worldY - a.worldY)
    if (d < d1) {
      a2 = a1
      d2 = d1
      a1 = a
      d1 = d
    } else if (d < d2) {
      a2 = a
      d2 = d
    }
  }

  if (anchors.length === 1 || a2 === null) {
    return applyWindWaves(worldX, worldY, elapsedSec, a1.direction, a1.strength)
  }

  const w1 = 1 / Math.max(d1, TWO_NEAREST_DIST_EPS)
  const w2 = 1 / Math.max(d2, TWO_NEAREST_DIST_EPS)
  const sumW = w1 + w2
  const sumDirX = Math.cos(a1.direction) * w1 + Math.cos(a2.direction) * w2
  const sumDirY = Math.sin(a1.direction) * w1 + Math.sin(a2.direction) * w2
  const baseDir = Math.atan2(sumDirY, sumDirX)
  const baseStrength = (a1.strength * w1 + a2.strength * w2) / sumW
  return applyWindWaves(worldX, worldY, elapsedSec, baseDir, baseStrength)
}

export function applyWindWaves(
  worldX: number,
  worldY: number,
  elapsedSec: number,
  baseDir: number,
  baseStrength: number
): { direction: number; strength: number } {
  const spatialWave =
    Math.sin(worldX * 0.009 + elapsedSec * 0.6) * 0.11 +
    Math.sin(worldY * 0.007 - elapsedSec * 0.45) * 0.08
  const direction = normalizeAngle(baseDir + spatialWave)

  const strengthWave =
    1 +
    Math.sin(worldX * 0.006 + elapsedSec * 0.75) * 0.12 +
    Math.sin((worldX + worldY) * 0.004 - elapsedSec * 0.35) * 0.07
  const strength = Math.max(0.4, baseStrength * strengthWave)

  return { direction, strength }
}

/**
 * Large-scale wind from a **cached** set of active anchors (e.g. those in range at last scan).
 * Only `activeAnchors` are weighted each frame (no full-map scan).
 * If the set is empty, or all weights vanish at this position, blends the **two closest** map
 * anchors by inverse-distance weights (vector direction, weighted-mean strength).
 */
export function sampleMapWindAtWithAnchors(
  map: FixedRouteMap,
  worldX: number,
  worldY: number,
  elapsedSec: number,
  activeAnchors: readonly WindAnchorPoint[]
): { direction: number; strength: number } {
  if (activeAnchors.length === 0) {
    return blendWindFromTwoNearestAnchors(map, worldX, worldY, elapsedSec)
  }

  let sumW = 0
  let sumDirX = 0
  let sumDirY = 0
  let sumStrength = 0

  for (const a of activeAnchors) {
    const dx = worldX - a.worldX
    const dy = worldY - a.worldY
    const w = influenceWeight(dx, dy)
    sumW += w
    sumDirX += Math.cos(a.direction) * w
    sumDirY += Math.sin(a.direction) * w
    sumStrength += a.strength * w
  }

  if (sumW <= 1e-6) {
    return blendWindFromTwoNearestAnchors(map, worldX, worldY, elapsedSec)
  }

  const baseDir = Math.atan2(sumDirY, sumDirX)
  const baseStrength = sumStrength / sumW
  return applyWindWaves(worldX, worldY, elapsedSec, baseDir, baseStrength)
}

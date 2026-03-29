import { normalizeAngle } from './Physics'

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

/**
 * A fixed map used every run:
 * - same start / finish
 * - same major wind anchor points
 */
export const FIXED_ROUTE_MAP: FixedRouteMap = {
  id: 'harbor-run-v2',
  label: 'Harbor Run',
  start: { worldX: -440, worldY: 240 },
  finish: { worldX: 520, worldY: -280, radius: 36 },
  windAnchors: [
    { id: 'w1', label: 'West Bay', worldX: -600, worldY: 340, direction: -0.32, strength: 2.6 },
    { id: 'w2', label: 'South Reach', worldX: -120, worldY: 480, direction: -1.12, strength: 3.0 },
    { id: 'w3', label: 'Mid Channel', worldX: 80, worldY: 80, direction: -0.64, strength: 3.4 },
    { id: 'w4', label: 'North Ridge', worldX: 360, worldY: -180, direction: -0.08, strength: 3.1 },
    { id: 'w5', label: 'East Gate', worldX: 600, worldY: -420, direction: 0.46, strength: 2.8 },
  ],
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

/** Distance weight ~ halved at this radius (smooth blend inside max reach). */
const ANCHOR_FALLOFF = 520
/** Past this distance from an anchor, it contributes nothing (hard cutoff). */
export const WIND_ANCHOR_MAX_REACH = ANCHOR_FALLOFF * 2

function influenceWeight(dx: number, dy: number): number {
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist >= WIND_ANCHOR_MAX_REACH) return 0
  const u = dist / ANCHOR_FALLOFF
  return 1 / (1 + u * u)
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

/** Closest anchor by Euclidean distance (for fallback when none are in range). */
export function nearestWindAnchor(map: FixedRouteMap, worldX: number, worldY: number): WindAnchorPoint {
  let best = map.windAnchors[0]
  let bestD2 = Infinity
  for (const a of map.windAnchors) {
    const dx = worldX - a.worldX
    const dy = worldY - a.worldY
    const d2 = dx * dx + dy * dy
    if (d2 < bestD2) {
      bestD2 = d2
      best = a
    }
  }
  return best
}

function applyWindWaves(
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
 * If the set is empty, or all weights vanish at this position, uses **nearest** anchor direction & strength.
 */
export function sampleMapWindAtWithAnchors(
  map: FixedRouteMap,
  worldX: number,
  worldY: number,
  elapsedSec: number,
  activeAnchors: readonly WindAnchorPoint[]
): { direction: number; strength: number } {
  if (activeAnchors.length === 0) {
    const a = nearestWindAnchor(map, worldX, worldY)
    return applyWindWaves(worldX, worldY, elapsedSec, a.direction, a.strength)
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
    const a = nearestWindAnchor(map, worldX, worldY)
    return applyWindWaves(worldX, worldY, elapsedSec, a.direction, a.strength)
  }

  const baseDir = Math.atan2(sumDirY, sumDirX)
  const baseStrength = sumStrength / sumW
  return applyWindWaves(worldX, worldY, elapsedSec, baseDir, baseStrength)
}

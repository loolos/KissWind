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

/**
 * A fixed map used every run:
 * - same start / finish
 * - same major wind anchor points
 */
export const FIXED_ROUTE_MAP: FixedRouteMap = {
  id: 'harbor-run-v1',
  label: 'Harbor Run',
  start: { worldX: -220, worldY: 120 },
  finish: { worldX: 260, worldY: -140, radius: 22 },
  windAnchors: [
    { id: 'w1', label: 'West Bay', worldX: -300, worldY: 170, direction: -0.32, strength: 2.6 },
    { id: 'w2', label: 'South Reach', worldX: -60, worldY: 240, direction: -1.12, strength: 3.0 },
    { id: 'w3', label: 'Mid Channel', worldX: 40, worldY: 40, direction: -0.64, strength: 3.4 },
    { id: 'w4', label: 'North Ridge', worldX: 180, worldY: -90, direction: -0.08, strength: 3.1 },
    { id: 'w5', label: 'East Gate', worldX: 300, worldY: -210, direction: 0.46, strength: 2.8 },
  ],
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

function influenceWeight(dx: number, dy: number): number {
  const dist = Math.sqrt(dx * dx + dy * dy)
  const falloff = 260
  const u = dist / falloff
  return 1 / (1 + u * u)
}

/**
 * Interpolates large-scale wind from fixed anchor points.
 * A small spatial + temporal perturbation keeps it dynamic at local scale.
 */
export function sampleMapWindAt(
  map: FixedRouteMap,
  worldX: number,
  worldY: number,
  elapsedSec: number
): { direction: number; strength: number } {
  let sumW = 0
  let sumDirX = 0
  let sumDirY = 0
  let sumStrength = 0

  for (const a of map.windAnchors) {
    const dx = worldX - a.worldX
    const dy = worldY - a.worldY
    const w = influenceWeight(dx, dy)
    sumW += w
    sumDirX += Math.cos(a.direction) * w
    sumDirY += Math.sin(a.direction) * w
    sumStrength += a.strength * w
  }

  if (sumW <= 1e-6) {
    return {
      direction: map.windAnchors[0].direction,
      strength: map.windAnchors[0].strength,
    }
  }

  const baseDir = Math.atan2(sumDirY, sumDirX)
  const baseStrength = sumStrength / sumW

  // Small local variation: deterministic by position + smooth in time.
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

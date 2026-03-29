import type { FixedRouteMap } from './fixedMap'

/**
 * World → screen scale for the ocean map (waves, debris, wind zones).
 * Previous behavior was equivalent to zoom = 1.
 *
 * `MAP_ZOOM_BASE` — default / reference zoom (world units → pixels); boat vis scale uses this baseline.
 */
export const MAP_ZOOM_BASE = 20

/**
 * Default race course: start / finish and **wind anchor** positions & fields.
 * Normal game start uses this map as-is (no per-run randomization).
 * For a new procedural layout, use `generateRandomRouteMap` from `./fixedMap`.
 */
export const DEFAULT_ROUTE_MAP: FixedRouteMap = {
  id: 'harbor-run-v2',
  label: 'Harbor Run',
  start: { worldX: -440, worldY: 240 },
  finish: { worldX: 520, worldY: -280, radius: 36 },
  windAnchors: [
    { id: 'w1', label: 'West Bay', worldX: -600, worldY: 340, direction: -1, strength: 2.6 },
    { id: 'w2', label: 'South Reach', worldX: -120, worldY: 480, direction: -1.12, strength: 3.0 },
    { id: 'w3', label: 'Mid Channel', worldX: 80, worldY: 80, direction: -0.64, strength: 3.4 },
    { id: 'w4', label: 'North Ridge', worldX: 360, worldY: -180, direction: 1, strength: 3.1 },
    { id: 'w5', label: 'East Gate', worldX: 600, worldY: -420, direction: 0.46, strength: 2.8 },
  ],
}

/** Discrete map zoom steps (larger = more pixels per world unit, “closer”). */
export const MAP_ZOOM_LEVELS = [20, 10, 5, 2] as const

/** Visible world half-extents around boat (for spawning / wrapping), in world units */
export function viewportHalfExtents(
  viewW: number,
  viewH: number,
  mapZoom: number = MAP_ZOOM_BASE
): { halfW: number; halfH: number } {
  const pad = 80 / mapZoom
  return {
    halfW: viewW / (2 * mapZoom) + pad,
    halfH: viewH / (2 * mapZoom) + pad,
  }
}

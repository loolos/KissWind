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
  lands: [
    {
      id: 'l1',
      kind: 'circle',
      worldX: -465,
      worldY: 385,
      radius: 85,
    },
    {
      id: 'l2',
      kind: 'polygon',
      points: [
        { x: -401.6, y: -183.2 },
        { x: -333.8, y: -205.6 },
        { x: -274.3, y: -196.6 },
        { x: -275.8, y: -157.9 },
        { x: -302.2, y: -128.4 },
        { x: -359.1, y: -125.2 },
        { x: -398.3, y: -158.0 },
      ],
    },
    {
      id: 'l3',
      kind: 'polygon',
      points: [
        { x: 256.1, y: -205.6 },
        { x: 375.8, y: -288.4 },
        { x: 495.4, y: -159.6 },
        { x: 477.0, y: -12.3 },
        { x: 329.8, y: 33.7 },
        { x: 200.9, y: -85.9 },
      ],
    },
    {
      id: 'l4',
      kind: 'circle',
      worldX: -105,
      worldY: -155,
      radius: 85,
    },
    {
      id: 'l5',
      kind: 'polygon',
      points: [
        { x: -22.1, y: 261.5 },
        { x: 53.2, y: 261.4 },
        { x: 97.7, y: 298.3 },
        { x: 47.9, y: 339.9 },
        { x: -51.7, y: 313.9 },
      ],
    },
  ],
  windAnchors: [
    { id: 'w1', label: 'West Bay', worldX: -400, worldY: 340, direction: 0, strength: 2.6 },
    { id: 'w2', label: 'South Reach', worldX: -120, worldY: 480, direction: 1, strength: 3.0 },
    { id: 'w3', label: 'Mid Channel', worldX: 80, worldY: 80, direction: -1.64, strength: 3.4 },
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

/**
 * World half-extents as if the map were at the most zoomed-out step.
 * Use for entities that should spawn/wrap in a band that does not shrink when the player zooms in.
 */
export function viewportHalfExtentsMaxZoomOut(
  viewW: number,
  viewH: number
): { halfW: number; halfH: number } {
  const minZoom = MAP_ZOOM_LEVELS[MAP_ZOOM_LEVELS.length - 1]
  return viewportHalfExtents(viewW, viewH, minZoom)
}

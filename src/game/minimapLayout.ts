import type { FixedMapBounds } from './fixedMap'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Same rules as `GameScene.getMiniMapLayout` width/height/pad (world-units ref uses inner box only). */
export function getMiniMapPixelLayout(viewW: number, viewH: number): {
  mapW: number
  mapH: number
  pad: number
  compact: boolean
} {
  const compact = viewW < 520 || viewH < 820
  const mapW = compact
    ? clamp(Math.round(viewW * 0.31), 128, 172)
    : clamp(Math.round(viewW * 0.22), 172, 236)
  const mapH = compact
    ? clamp(Math.round(viewH * 0.19), 96, 128)
    : clamp(Math.round(viewH * 0.2), 128, 176)
  const pad = compact ? 10 : 12
  return { mapW, mapH, pad, compact }
}

/**
 * World-distance that matches the **shorter inner edge** of the minimap (after padding),
 * using the same scale as `drawMiniMap`. Used so e.g. 5% / 10% homing thresholds follow
 * “5% / 10% of minimap side length” in world space.
 */
export function getMinimapEdgeWorldRef(viewW: number, viewH: number, bounds: FixedMapBounds): number {
  const { mapW, mapH, pad } = getMiniMapPixelLayout(viewW, viewH)
  const availW = mapW - pad * 2
  const availH = mapH - pad * 2
  const scale = Math.min(availW / bounds.width, availH / bounds.height)
  const edgePx = Math.min(availW, availH)
  return edgePx / scale
}

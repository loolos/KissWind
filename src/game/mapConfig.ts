/**
 * World → screen scale for the ocean map (waves, debris, wind zones).
 * Previous behavior was equivalent to zoom = 1.
 *
 * `MAP_ZOOM_BASE` — default / reference zoom (world units → pixels); boat vis scale uses this baseline.
 */
export const MAP_ZOOM_BASE = 20

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

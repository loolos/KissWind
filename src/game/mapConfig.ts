/**
 * World → screen scale for the ocean map (waves, debris, wind zones).
 * Previous behavior was equivalent to zoom = 1.
 */
export const MAP_ZOOM = 20

/** Visible world half-extents around boat (for spawning / wrapping), in world units */
export function viewportHalfExtents(
  viewW: number,
  viewH: number,
  mapZoom: number = MAP_ZOOM
): { halfW: number; halfH: number } {
  const pad = 80 / mapZoom
  return {
    halfW: viewW / (2 * mapZoom) + pad,
    halfH: viewH / (2 * mapZoom) + pad,
  }
}

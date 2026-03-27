/**
 * Boat-centered map projection (see docs/coordinate-system.md).
 * World units match physics posX/posY; zoom maps displacement to pixels.
 */

export function worldToScreen(
  wx: number,
  wy: number,
  boatX: number,
  boatY: number,
  zoom: number,
  viewW: number,
  viewH: number
): { sx: number; sy: number } {
  return {
    sx: viewW / 2 + (wx - boatX) * zoom,
    sy: viewH / 2 + (wy - boatY) * zoom,
  }
}

export function screenToWorld(
  sx: number,
  sy: number,
  boatX: number,
  boatY: number,
  zoom: number,
  viewW: number,
  viewH: number
): { wx: number; wy: number } {
  return {
    wx: boatX + (sx - viewW / 2) / zoom,
    wy: boatY + (sy - viewH / 2) / zoom,
  }
}

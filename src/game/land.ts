export interface LandPoint {
  x: number
  y: number
}

export type LandMass =
  | {
      id: string
      kind: 'circle'
      worldX: number
      worldY: number
      radius: number
    }
  | {
      id: string
      kind: 'rect'
      worldX: number
      worldY: number
      width: number
      height: number
      rotation: number
    }
  | {
      id: string
      kind: 'polygon'
      points: LandPoint[]
    }

function rotateIntoLocal(x: number, y: number, cx: number, cy: number, rot: number): LandPoint {
  const dx = x - cx
  const dy = y - cy
  const c = Math.cos(-rot)
  const s = Math.sin(-rot)
  return {
    x: dx * c - dy * s,
    y: dx * s + dy * c,
  }
}

function pointInPolygon(points: LandPoint[], x: number, y: number): boolean {
  if (points.length < 3) return false
  let inside = false
  let j = points.length - 1
  for (let i = 0; i < points.length; i++) {
    const pi = points[i]
    const pj = points[j]
    const intersects =
      (pi.y > y) !== (pj.y > y) &&
      x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y + 1e-12) + pi.x
    if (intersects) inside = !inside
    j = i
  }
  return inside
}

function distancePointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const vv = vx * vx + vy * vy
  if (vv <= 1e-12) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv))
  const cx = ax + vx * t
  const cy = ay + vy * t
  return Math.hypot(px - cx, py - cy)
}

function polygonEdgeDistance(points: LandPoint[], x: number, y: number): number {
  if (points.length < 2) return Infinity
  let best = Infinity
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    best = Math.min(best, distancePointToSegment(x, y, a.x, a.y, b.x, b.y))
  }
  return best
}

function polygonCentroid(points: LandPoint[]): LandPoint {
  if (points.length === 0) return { x: 0, y: 0 }
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  return { x: sx / points.length, y: sy / points.length }
}

export function landApproxRadius(land: LandMass): number {
  switch (land.kind) {
    case 'circle':
      return land.radius
    case 'rect':
      return Math.hypot(land.width * 0.5, land.height * 0.5)
    case 'polygon': {
      const c = polygonCentroid(land.points)
      let r = 0
      for (const p of land.points) r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y))
      return r
    }
  }
}

export function isPointOnLandMass(land: LandMass, worldX: number, worldY: number, margin = 0): boolean {
  switch (land.kind) {
    case 'circle': {
      const dx = worldX - land.worldX
      const dy = worldY - land.worldY
      const r = Math.max(0, land.radius + margin)
      return dx * dx + dy * dy <= r * r
    }
    case 'rect': {
      const local = rotateIntoLocal(worldX, worldY, land.worldX, land.worldY, land.rotation)
      const hx = Math.max(0, land.width * 0.5 + margin)
      const hy = Math.max(0, land.height * 0.5 + margin)
      return Math.abs(local.x) <= hx && Math.abs(local.y) <= hy
    }
    case 'polygon': {
      if (pointInPolygon(land.points, worldX, worldY)) return true
      if (margin <= 0) return false
      return polygonEdgeDistance(land.points, worldX, worldY) <= margin
    }
  }
}

export function isPointOnAnyLand(
  lands: readonly LandMass[] | undefined,
  worldX: number,
  worldY: number,
  margin = 0
): boolean {
  if (!lands || lands.length === 0) return false
  for (const land of lands) {
    if (isPointOnLandMass(land, worldX, worldY, margin)) return true
  }
  return false
}

export interface LandBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export function getLandBounds(land: LandMass): LandBounds {
  switch (land.kind) {
    case 'circle':
      return {
        minX: land.worldX - land.radius,
        maxX: land.worldX + land.radius,
        minY: land.worldY - land.radius,
        maxY: land.worldY + land.radius,
      }
    case 'rect': {
      const hx = land.width * 0.5
      const hy = land.height * 0.5
      const c = Math.cos(land.rotation)
      const s = Math.sin(land.rotation)
      const corners: LandPoint[] = [
        { x: -hx, y: -hy },
        { x: hx, y: -hy },
        { x: hx, y: hy },
        { x: -hx, y: hy },
      ].map((p) => ({
        x: land.worldX + p.x * c - p.y * s,
        y: land.worldY + p.x * s + p.y * c,
      }))
      return {
        minX: Math.min(...corners.map((p) => p.x)),
        maxX: Math.max(...corners.map((p) => p.x)),
        minY: Math.min(...corners.map((p) => p.y)),
        maxY: Math.max(...corners.map((p) => p.y)),
      }
    }
    case 'polygon':
      return {
        minX: Math.min(...land.points.map((p) => p.x)),
        maxX: Math.max(...land.points.map((p) => p.x)),
        minY: Math.min(...land.points.map((p) => p.y)),
        maxY: Math.max(...land.points.map((p) => p.y)),
      }
  }
}

/** Returns earliest collision fraction `t ∈ [0,1]`, or `null` if clear. */
export function firstLandHitAlongSegment(
  lands: readonly LandMass[] | undefined,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  margin = 0,
  coarseSteps = 24
): number | null {
  if (!lands || lands.length === 0) return null
  if (isPointOnAnyLand(lands, fromX, fromY, margin)) return 0

  let prevT = 0
  for (let i = 1; i <= coarseSteps; i++) {
    const t = i / coarseSteps
    const x = fromX + (toX - fromX) * t
    const y = fromY + (toY - fromY) * t
    if (!isPointOnAnyLand(lands, x, y, margin)) {
      prevT = t
      continue
    }
    let lo = prevT
    let hi = t
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) * 0.5
      const mx = fromX + (toX - fromX) * mid
      const my = fromY + (toY - fromY) * mid
      if (isPointOnAnyLand(lands, mx, my, margin)) hi = mid
      else lo = mid
    }
    return hi
  }
  return null
}

function rotateVecToWorld(lx: number, ly: number, rot: number): { x: number; y: number } {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return { x: lx * c - ly * s, y: lx * s + ly * c }
}

function closestPointOnPolygonBoundary(points: LandPoint[], x: number, y: number): LandPoint {
  if (points.length < 2) return { x, y }
  let bestD = Infinity
  let bestX = x
  let bestY = y
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const vx = b.x - a.x
    const vy = b.y - a.y
    const wx = x - a.x
    const wy = y - a.y
    const vv = vx * vx + vy * vy
    const t = vv <= 1e-12 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv))
    const qx = a.x + vx * t
    const qy = a.y + vy * t
    const d = Math.hypot(x - qx, y - qy)
    if (d < bestD) {
      bestD = d
      bestX = qx
      bestY = qy
    }
  }
  return { x: bestX, y: bestY }
}

/** Water-side unit normal at `worldX/worldY` for the nearest expanded land (margin = boat hull). */
export function nearestLandOutwardNormal(
  lands: readonly LandMass[] | undefined,
  worldX: number,
  worldY: number,
  margin: number
): { nx: number; ny: number } | null {
  if (!lands || lands.length === 0) return null
  let bestAbs = Infinity
  let bestNx = 0
  let bestNy = 0

  for (const land of lands) {
    if (land.kind === 'circle') {
      const dx = worldX - land.worldX
      const dy = worldY - land.worldY
      const dist = Math.hypot(dx, dy)
      if (dist < 1e-5) continue
      const r = Math.max(0, land.radius + margin)
      const absGap = Math.abs(dist - r)
      if (absGap < bestAbs) {
        bestAbs = absGap
        bestNx = dx / dist
        bestNy = dy / dist
      }
      continue
    }

    if (land.kind === 'rect') {
      const local = rotateIntoLocal(worldX, worldY, land.worldX, land.worldY, land.rotation)
      const hx = Math.max(0, land.width * 0.5 + margin)
      const hy = Math.max(0, land.height * 0.5 + margin)
      const cx = Math.max(-hx, Math.min(hx, local.x))
      const cy = Math.max(-hy, Math.min(hy, local.y))
      let lx = local.x - cx
      let ly = local.y - cy
      const len = Math.hypot(lx, ly)
      if (len < 1e-5) {
        const ax = Math.abs(local.x) / hx
        const ay = Math.abs(local.y) / hy
        if (ax > ay) {
          lx = Math.sign(local.x) || 1
          ly = 0
        } else {
          lx = 0
          ly = Math.sign(local.y) || 1
        }
      } else {
        lx /= len
        ly /= len
      }
      const w = rotateVecToWorld(lx, ly, land.rotation)
      const gap = Math.hypot(local.x - cx, local.y - cy)
      if (gap < bestAbs) {
        bestAbs = gap
        bestNx = w.x
        bestNy = w.y
      }
      continue
    }

    const q = closestPointOnPolygonBoundary(land.points, worldX, worldY)
    const qdx = worldX - q.x
    const qdy = worldY - q.y
    const qlen = Math.hypot(qdx, qdy)
    const inside = pointInPolygon(land.points, worldX, worldY)
    let nx: number
    let ny: number
    if (qlen < 1e-5) {
      const c = polygonCentroid(land.points)
      const ux = worldX - c.x
      const uy = worldY - c.y
      const ulen = Math.hypot(ux, uy)
      if (ulen < 1e-5) continue
      nx = ux / ulen
      ny = uy / ulen
    } else if (inside) {
      nx = -qdx / qlen
      ny = -qdy / qlen
    } else {
      nx = qdx / qlen
      ny = qdy / qlen
    }
    const edgeD = polygonEdgeDistance(land.points, worldX, worldY)
    const polyMetric = inside ? edgeD : Math.max(0, edgeD - margin)
    if (polyMetric < bestAbs) {
      bestAbs = polyMetric
      bestNx = nx
      bestNy = ny
    }
  }

  if (bestAbs === Infinity) return null
  const nlen = Math.hypot(bestNx, bestNy)
  if (nlen < 1e-8) return null
  return { nx: bestNx / nlen, ny: bestNy / nlen }
}

/**
 * Zero velocity along the land normal (perpendicular to the shoreline tangent in the water plane).
 * Remaining motion is purely tangential; `normal` points from land into water.
 */
export function projectVelocityAlongLand(
  velX: number,
  velY: number,
  nx: number,
  ny: number
): { velX: number; velY: number } {
  const dot = velX * nx + velY * ny
  return {
    velX: velX - dot * nx,
    velY: velY - dot * ny,
  }
}

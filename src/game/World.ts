import Phaser from 'phaser'
import { boatDebrisBoundaryAlongRay } from './Boat'
import { screenToWorld, worldToScreen } from './camera'
import { MAP_ZOOM_BASE, viewportHalfExtents } from './mapConfig'
import { WindZone } from './Wind'
import type { FixedRouteMap } from './fixedMap'
import type { LandMass } from './land'

/** Floating debris velocity damping (1/s), ~water drag on props. */
const DEBRIS_VEL_DRAG = 0.95
/** Plank → shard count range. */
const PLANK_SHARD_MIN = 4
const PLANK_SHARD_MAX = 7
/** Shards disappear after this many seconds. */
const SHARD_TTL_MIN = 10
const SHARD_TTL_MAX = 16
/** Tighten debris circle vs drawn sprite so hits match visuals. */
const DEBRIS_RADIUS_VIS_SCALE = 0.68
/** Boat velocity loss along impact (~50% gentler than first tuning). */
const BOAT_SLOW_PLANK = 0.17
const BOAT_SLOW_BUOY = 0.11
const BOAT_SLOW_BARREL = 0.13
const BOAT_SLOW_SHARD = 0.15

/** World-space drift speed scale (units/s), multiplied by each line’s random speed and current strength. */
const WAVE_DRIFT_SPEED = 1.1
/** `speed` from WaterCurrent — maps to drift multiplier (~1 at mid range). */
const WAVE_FLOW_SPEED_REF = 2.8

/** Decorative swell contours: wavelength & amplitude in world units (locked to world, not the screen). */
const WAVE_CONTOUR_WL = 34
const WAVE_CONTOUR_AMP = 4.2
const WAVE_CONTOUR_SPACING = 16
/** Horizontal strips for water tint; many + world-based color avoids obvious “screen stripes”. */
const WATER_TINT_STRIPS = 28

interface Debris {
  worldX: number
  worldY: number
  type: 'buoy' | 'plank' | 'barrel' | 'shard'
  color: number
  size: number
  rotation: number
  rotSpeed: number
  velX: number
  velY: number
  /** Channel-style two-digit mark (buoy only). */
  buoyMark?: number
  /** Shards only — removed when elapsed. */
  ttlSec?: number
}

/** 7-segment patterns: bits a,b,c,d,e,f,g = 1,2,4,8,16,32,64 */
const BUOY_SEG7: number[] = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x7b]

interface WaveLine {
  worldX: number
  worldY: number
  length: number
  alpha: number
  speed: number
}

export class World {
  private scene: Phaser.Scene
  private waterGraphics: Phaser.GameObjects.Graphics
  private landGraphics: Phaser.GameObjects.Graphics
  private debrisGraphics: Phaser.GameObjects.Graphics
  private zoneGraphics: Phaser.GameObjects.Graphics
  private readonly lands: readonly LandMass[]

  private debris: Debris[] = []
  private waveLines: WaveLine[] = []
  private waveOffset: number = 0

  /** World units → screen pixels (see mapConfig) */
  mapZoom: number

  constructor(scene: Phaser.Scene, routeMap?: FixedRouteMap, mapZoom: number = MAP_ZOOM_BASE) {
    this.scene = scene
    this.mapZoom = mapZoom
    this.lands = routeMap?.lands ?? []

    this.waterGraphics = scene.add.graphics()
    this.waterGraphics.setDepth(0)

    this.landGraphics = scene.add.graphics()
    this.landGraphics.setDepth(1)

    this.zoneGraphics = scene.add.graphics()
    this.zoneGraphics.setDepth(2)

    this.debrisGraphics = scene.add.graphics()
    this.debrisGraphics.setDepth(3)

    this.initDebris(0, 0)
    this.initWaveLines(0, 0)
  }

  /** Visible world half-extents around boat (for spawning / wrapping), in world units */
  private viewportHalfExtents(): { halfW: number; halfH: number } {
    return viewportHalfExtents(this.scene.scale.width, this.scene.scale.height, this.mapZoom)
  }

  private initDebris(boatX: number, boatY: number): void {
    const { halfW, halfH } = this.viewportHalfExtents()
    const count = 8

    const debrisTypes: Array<'buoy' | 'plank' | 'barrel'> = ['buoy', 'plank', 'barrel']
    const colors = [0xff6633, 0xaa8855, 0x886644, 0xffaa33, 0xcc4422]
    const buoyColors = [0xdc2a2a, 0xe83333, 0xd42222, 0xee3a2e, 0xc42828]

    for (let i = 0; i < count; i++) {
      const type = debrisTypes[Math.floor(Math.random() * debrisTypes.length)]
      const palette = type === 'buoy' ? buoyColors : colors
      const piece: Debris = {
        worldX: boatX + (Math.random() * 2 - 1) * halfW,
        worldY: boatY + (Math.random() * 2 - 1) * halfH,
        type,
        color: palette[Math.floor(Math.random() * palette.length)],
        size: 4 + Math.random() * 8,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.5,
        velX: 0,
        velY: 0,
      }
      if (type === 'buoy') {
        piece.buoyMark = 10 + Math.floor(Math.random() * 90)
        piece.rotation = 0
        piece.rotSpeed = 0
      }
      this.debris.push(piece)
    }
  }

  private initWaveLines(boatX: number, boatY: number): void {
    const { halfW, halfH } = this.viewportHalfExtents()
    const count = 35

    for (let i = 0; i < count; i++) {
      this.waveLines.push({
        worldX: boatX + (Math.random() * 2 - 1) * halfW,
        worldY: boatY + (Math.random() * 2 - 1) * halfH,
        length: 20 + Math.random() * 60,
        alpha: 0.05 + Math.random() * 0.15,
        speed: 0.5 + Math.random() * 1.0,
      })
    }
  }

  private wrapWorldPoint(
    p: { worldX: number; worldY: number },
    boatX: number,
    boatY: number,
    halfW: number,
    halfH: number
  ): void {
    let dx = p.worldX - boatX
    let dy = p.worldY - boatY
    if (dx > halfW) p.worldX -= 2 * halfW
    else if (dx < -halfW) p.worldX += 2 * halfW
    if (dy > halfH) p.worldY -= 2 * halfH
    else if (dy < -halfH) p.worldY += 2 * halfH
  }

  update(
    dt: number,
    boatX: number,
    boatY: number,
    windDir: number,
    _windStrength: number,
    zones: WindZone[],
    /** Direction surface water flows toward (radians). Background swell contours run ⊥ to this. */
    waterFlowDir: number,
    waterFlowSpeed: number
  ): void {
    const { halfW, halfH } = this.viewportHalfExtents()

    const flowScale = Phaser.Math.Clamp(waterFlowSpeed / WAVE_FLOW_SPEED_REF, 0.62, 1.38)

    // Swell / ripple drift with current; shimmer time independent of wind
    this.waveOffset += dt * 1.2

    for (const wl of this.waveLines) {
      const step = WAVE_DRIFT_SPEED * wl.speed * dt * flowScale
      wl.worldX += Math.cos(waterFlowDir) * step
      wl.worldY += Math.sin(waterFlowDir) * step
      this.wrapWorldPoint(wl, boatX, boatY, halfW, halfH)
    }

    const drag = Math.exp(-DEBRIS_VEL_DRAG * dt)
    this.debris = this.debris.filter(d => {
      if (d.ttlSec !== undefined) {
        d.ttlSec -= dt
        if (d.ttlSec <= 0) return false
      }
      d.rotation += d.rotSpeed * dt
      d.worldX += d.velX * dt
      d.worldY += d.velY * dt
      d.velX *= drag
      d.velY *= drag
      this.wrapWorldPoint(d, boatX, boatY, halfW, halfH)
      return true
    })

    this.draw(windDir, zones, boatX, boatY, waterFlowDir)
  }

  /**
   * Resolve hull vs debris: buoys/barrels/shards get pushed with momentum-style transfer;
   * planks shatter into shards. Applies a small velocity kick opposite the impact on the boat.
   */
  applyBoatDebrisCollision(
    boatX: number,
    boatY: number,
    boatVelX: number,
    boatVelY: number,
    mapZoom: number,
    /** Hull long axis (same frame as `Boat.heading` / ground course). */
    boatHeading: number
  ): { dvx: number; dvy: number } {
    let dvx = 0
    let dvy = 0
    const hx = Math.cos(boatHeading)
    const hy = Math.sin(boatHeading)

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]
      const dx = d.worldX - boatX
      const dy = d.worldY - boatY
      const dist = Math.hypot(dx, dy)
      const r = this.debrisCollisionRadius(d, mapZoom)
      if (dist < 1e-6) continue
      const along = dx * hx + dy * hy
      const across = -dx * hy + dy * hx
      const boundary = boatDebrisBoundaryAlongRay(along, across, r, mapZoom)
      if (dist >= boundary) continue

      const nx = dx / dist
      const ny = dy / dist
      const overlap = boundary - dist
      d.worldX += nx * overlap
      d.worldY += ny * overlap

      const relVx = boatVelX - d.velX
      const relVy = boatVelY - d.velY
      const relAlong = relVx * nx + relVy * ny
      const approach = Math.max(0.15, relAlong)

      if (d.type === 'plank') {
        const nShards = Phaser.Math.Between(PLANK_SHARD_MIN, PLANK_SHARD_MAX)
        const shards: Debris[] = []
        for (let s = 0; s < nShards; s++) {
          const baseAng = (s / nShards) * Math.PI * 2 + (Math.random() - 0.5) * 0.9
          const kick = approach * (0.55 + Math.random() * 0.45) + Math.random() * 0.9
          const tx = -ny
          const ty = nx
          const tang = (Math.random() - 0.5) * 1.1
          shards.push({
            worldX: d.worldX + (Math.random() - 0.5) * r * 0.4,
            worldY: d.worldY + (Math.random() - 0.5) * r * 0.4,
            type: 'shard',
            color: d.color,
            size: d.size * (0.28 + Math.random() * 0.22),
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 2.2,
            velX: d.velX + Math.cos(baseAng) * kick + tx * tang,
            velY: d.velY + Math.sin(baseAng) * kick + ty * tang,
            ttlSec: Phaser.Math.FloatBetween(SHARD_TTL_MIN, SHARD_TTL_MAX),
          })
        }
        this.debris.splice(i, 1, ...shards)
        dvx -= BOAT_SLOW_PLANK * approach * nx
        dvy -= BOAT_SLOW_PLANK * approach * ny
        continue
      }

      // Buoy / barrel / shard — inelastic push; buoy moves less than light debris.
      let debrisGain: number
      let boatLossAlong: number
      if (d.type === 'buoy') {
        debrisGain = 0.14 + approach * 0.2
        boatLossAlong = BOAT_SLOW_BUOY
      } else if (d.type === 'barrel') {
        debrisGain = 0.2 + approach * 0.28
        boatLossAlong = BOAT_SLOW_BARREL
      } else {
        debrisGain = 0.26 + approach * 0.38
        boatLossAlong = BOAT_SLOW_SHARD
      }

      d.velX += nx * debrisGain
      d.velY += ny * debrisGain
      dvx -= boatLossAlong * approach * nx
      dvy -= boatLossAlong * approach * ny

      if (d.type === 'buoy') {
        d.rotSpeed += (Math.random() - 0.5) * 0.35
      }
    }

    return { dvx, dvy }
  }

  private debrisCollisionRadius(d: Debris, mapZoom: number): number {
    const z = mapZoom
    const s = d.size
    let raw: number
    switch (d.type) {
      case 'buoy':
        raw = (2.05 * s) / z
        break
      case 'plank':
        raw = (3.0 * s) / z
        break
      case 'barrel':
        raw = (2.45 * s) / z
        break
      case 'shard':
        raw = (1.25 * s) / z
        break
      default:
        raw = (2 * s) / z
    }
    return raw * DEBRIS_RADIUS_VIS_SCALE
  }

  /** Depth tint from world Y so the base moves with the map (not glued to the screen). */
  private waterTintFromWorldY(wy: number, boatY: number, zoom: number, viewH: number): number {
    const span = Math.max(viewH / zoom, 90)
    const t = Phaser.Math.Clamp(0.5 + (wy - boatY) / span * 0.5, 0, 1)
    const stops = [
      { r: 10, g: 32, b: 80 },
      { r: 12, g: 38, b: 92 },
      { r: 14, g: 48, b: 104 },
      { r: 16, g: 58, b: 116 },
      { r: 18, g: 68, b: 128 },
      { r: 20, g: 80, b: 140 },
    ]
    const n = stops.length - 1
    const f = t * n
    const i0 = Math.floor(f)
    const i1 = Math.min(i0 + 1, n)
    const u = f - i0
    const a = stops[i0]
    const b = stops[i1]
    return Phaser.Display.Color.GetColor(
      Math.round(a.r + (b.r - a.r) * u),
      Math.round(a.g + (b.g - a.g) * u),
      Math.round(a.b + (b.b - a.b) * u)
    )
  }

  /**
   * Swell contours in **world** coordinates: polylines extend along axis S; phase undulates in P ⟂ S.
   * S must be **perpendicular to water flow** so visible wave bands cross the current, not run with it.
   * `waterFlowDir` = direction water flows toward; we use S = flow + π/2.
   */
  private drawWaterWaveContours(
    boatX: number,
    boatY: number,
    z: number,
    w: number,
    h: number,
    waterFlowDir: number
  ): void {
    const g = this.waterGraphics
    const margin = 1.35
    const spanAlong = (Math.max(w, h) / z) * margin
    const spanPerp = spanAlong
    const steps = Math.min(96, Math.max(40, Math.ceil(spanAlong * 0.72)))
    const swellAlongDir = waterFlowDir + Math.PI / 2
    const cosS = Math.cos(swellAlongDir)
    const sinS = Math.sin(swellAlongDir)
    const k = (Math.PI * 2) / WAVE_CONTOUR_WL
    const k2 = k * 1.85

    const aCenter = boatX * cosS + boatY * sinS
    const pBoat = -boatX * sinS + boatY * cosS
    const lineMin = Math.floor((pBoat - spanPerp) / WAVE_CONTOUR_SPACING) - 2
    const lineMax = Math.ceil((pBoat + spanPerp) / WAVE_CONTOUR_SPACING) + 2

    const timeAng1 = this.waveOffset * 0.38
    const timeAng2 = this.waveOffset * 0.22

    for (let line = lineMin; line <= lineMax; line++) {
      const pRest = line * WAVE_CONTOUR_SPACING
      const linePhase = line * 0.31
      const alpha = 0.06 + (Math.abs(line) % 3) * 0.018

      g.lineStyle(1.25, 0x7ab0dc, alpha)
      g.beginPath()
      for (let s = 0; s <= steps; s++) {
        const a = aCenter - spanAlong + (2 * spanAlong * s) / steps
        const w1 = Math.sin(a * k + timeAng1 + linePhase) * WAVE_CONTOUR_AMP
        const w2 =
          Math.sin(a * k2 + timeAng2 + linePhase * 1.7) * (WAVE_CONTOUR_AMP * 0.28)
        const p = pRest + w1 + w2
        const wx = a * cosS - p * sinS
        const wy = a * sinS + p * cosS
        const scr = worldToScreen(wx, wy, boatX, boatY, z, w, h)
        if (s === 0) g.moveTo(scr.sx, scr.sy)
        else g.lineTo(scr.sx, scr.sy)
      }
      g.strokePath()
    }
  }

  private draw(
    windDir: number,
    zones: WindZone[],
    boatX: number,
    boatY: number,
    waterFlowDir: number
  ): void {
    const w = this.scene.scale.width
    const h = this.scene.scale.height
    const z = this.mapZoom

    // Draw water background
    this.waterGraphics.clear()

    for (let i = 0; i < WATER_TINT_STRIPS; i++) {
      const y0 = (i / WATER_TINT_STRIPS) * h
      const y1 = ((i + 1) / WATER_TINT_STRIPS) * h + 1
      const midY = (y0 + y1) * 0.5
      const { wy } = screenToWorld(w * 0.5, midY, boatX, boatY, z, w, h)
      const color = this.waterTintFromWorldY(wy, boatY, z, h)
      this.waterGraphics.fillStyle(color, 1)
      this.waterGraphics.fillRect(0, y0, w, y1 - y0)
    }

    this.drawWaterWaveContours(boatX, boatY, z, w, h, waterFlowDir)
    this.drawLands(boatX, boatY, z, w, h)

    for (const wl of this.waveLines) {
      const perpX = Math.cos(waterFlowDir + Math.PI / 2)
      const perpY = Math.sin(waterFlowDir + Math.PI / 2)
      const half = wl.length / 2
      const c = worldToScreen(wl.worldX, wl.worldY, boatX, boatY, z, w, h)
      const shimmer =
        Math.sin(wl.worldX * 0.5 + wl.worldY * 0.3 + this.waveOffset * 0.1) * 0.05

      this.waterGraphics.lineStyle(1.5, 0x88bbdd, wl.alpha + shimmer)
      this.waterGraphics.beginPath()
      this.waterGraphics.moveTo(c.sx - perpX * half, c.sy - perpY * half)
      this.waterGraphics.lineTo(c.sx + perpX * half, c.sy + perpY * half)
      this.waterGraphics.strokePath()
    }

    this.zoneGraphics.clear()
    for (const zone of zones) {
      const p = worldToScreen(zone.worldX, zone.worldY, boatX, boatY, z, w, h)
      const sx = p.sx
      const sy = p.sy
      const r = zone.radius * z

      if (sx < -r * 2 || sx > w + r * 2) continue
      if (sy < -r * 2 || sy > h + r * 2) continue

      const color = zone.type === 'gust' ? 0xffdd00 : 0x888888
      const alpha = 0.18

      this.zoneGraphics.fillStyle(color, alpha * 0.4)
      this.zoneGraphics.fillCircle(sx, sy, r * 1.3)

      this.zoneGraphics.fillStyle(color, alpha)
      this.zoneGraphics.fillCircle(sx, sy, r)

      this.zoneGraphics.fillStyle(color, alpha * 1.5)
      this.zoneGraphics.fillCircle(sx, sy, r * 0.4)

      this.zoneGraphics.lineStyle(1.5, color, 0.5)
      this.zoneGraphics.strokeCircle(sx, sy, r)

      if (r > 60) {
        if (zone.type === 'gust') {
          const a = Math.min(15, 8 + r * 0.06)
          this.drawArrow(this.zoneGraphics, sx, sy, windDir, a, 0xffee88, 0.8)
          this.drawArrow(this.zoneGraphics, sx - 12, sy, windDir, a * 0.65, 0xffee88, 0.5)
          this.drawArrow(this.zoneGraphics, sx + 12, sy, windDir, a * 0.65, 0xffee88, 0.5)
        } else {
          this.zoneGraphics.lineStyle(2, 0xaaaaaa, 0.6)
          this.zoneGraphics.beginPath()
          this.zoneGraphics.moveTo(sx - 10, sy - 10)
          this.zoneGraphics.lineTo(sx + 10, sy + 10)
          this.zoneGraphics.moveTo(sx + 10, sy - 10)
          this.zoneGraphics.lineTo(sx - 10, sy + 10)
          this.zoneGraphics.strokePath()
        }
      }
    }

    this.debrisGraphics.clear()
    for (const d of this.debris) {
      const scr = worldToScreen(d.worldX, d.worldY, boatX, boatY, z, w, h)
      this.drawDebris(d, scr.sx, scr.sy)
    }
  }

  private drawLands(boatX: number, boatY: number, z: number, w: number, h: number): void {
    this.landGraphics.clear()
    if (this.lands.length === 0) return
    const g = this.landGraphics
    const fillColor = 0x6b5344
    const fillColor2 = 0x7d5f48
    const edgeColor = 0x3a2c22
    const beachColor = 0x5a4636

    for (const land of this.lands) {
      if (land.kind === 'circle') {
        const p = worldToScreen(land.worldX, land.worldY, boatX, boatY, z, w, h)
        const r = land.radius * z
        if (p.sx < -r * 2 || p.sy < -r * 2 || p.sx > w + r * 2 || p.sy > h + r * 2) continue
        g.fillStyle(fillColor, 0.96)
        g.fillCircle(p.sx, p.sy, r)
        g.fillStyle(fillColor2, 0.3)
        g.fillCircle(p.sx + r * 0.16, p.sy - r * 0.12, r * 0.58)
        g.lineStyle(2, beachColor, 0.8)
        g.strokeCircle(p.sx, p.sy, r * 0.96)
        g.lineStyle(2, edgeColor, 0.92)
        g.strokeCircle(p.sx, p.sy, r)
        continue
      }

      if (land.kind === 'rect') {
        const hx = land.width * 0.5
        const hy = land.height * 0.5
        const c = Math.cos(land.rotation)
        const s = Math.sin(land.rotation)
        const corners = [
          { x: -hx, y: -hy },
          { x: hx, y: -hy },
          { x: hx, y: hy },
          { x: -hx, y: hy },
        ].map((pt) => {
          const wx = land.worldX + pt.x * c - pt.y * s
          const wy = land.worldY + pt.x * s + pt.y * c
          return worldToScreen(wx, wy, boatX, boatY, z, w, h)
        })
        g.fillStyle(fillColor, 0.95)
        g.beginPath()
        g.moveTo(corners[0].sx, corners[0].sy)
        for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].sx, corners[i].sy)
        g.closePath()
        g.fillPath()
        g.lineStyle(2, beachColor, 0.75)
        g.beginPath()
        g.moveTo(corners[0].sx, corners[0].sy)
        for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].sx, corners[i].sy)
        g.closePath()
        g.strokePath()
        g.lineStyle(2, edgeColor, 0.92)
        g.beginPath()
        g.moveTo(corners[0].sx, corners[0].sy)
        for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].sx, corners[i].sy)
        g.closePath()
        g.strokePath()
        continue
      }

      if (land.points.length < 3) continue
      const pts = land.points.map((pt) => worldToScreen(pt.x, pt.y, boatX, boatY, z, w, h))
      g.fillStyle(fillColor, 0.95)
      g.beginPath()
      g.moveTo(pts[0].sx, pts[0].sy)
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].sx, pts[i].sy)
      g.closePath()
      g.fillPath()
      g.lineStyle(2, beachColor, 0.75)
      g.beginPath()
      g.moveTo(pts[0].sx, pts[0].sy)
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].sx, pts[i].sy)
      g.closePath()
      g.strokePath()
      g.lineStyle(2, edgeColor, 0.92)
      g.beginPath()
      g.moveTo(pts[0].sx, pts[0].sy)
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].sx, pts[i].sy)
      g.closePath()
      g.strokePath()
    }
  }

  private drawArrow(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    angle: number,
    size: number,
    color: number,
    alpha: number
  ): void {
    g.lineStyle(2, color, alpha)
    const ex = x + Math.cos(angle) * size
    const ey = y + Math.sin(angle) * size
    g.beginPath()
    g.moveTo(x - Math.cos(angle) * size * 0.5, y - Math.sin(angle) * size * 0.5)
    g.lineTo(ex, ey)
    g.strokePath()

    const headSize = size * 0.35
    const left = angle + Math.PI * 0.75
    const right = angle - Math.PI * 0.75
    g.fillStyle(color, alpha)
    g.beginPath()
    g.moveTo(ex, ey)
    g.lineTo(ex + Math.cos(left) * headSize, ey + Math.sin(left) * headSize)
    g.lineTo(ex + Math.cos(right) * headSize, ey + Math.sin(right) * headSize)
    g.closePath()
    g.fillPath()
  }

  /** Local (lx, ly) → screen; ly positive = down on screen. */
  private debrisLocalToScreen(
    lx: number,
    ly: number,
    ox: number,
    oy: number,
    cos: number,
    sin: number
  ): { sx: number; sy: number } {
    return {
      sx: ox + lx * cos - ly * sin,
      sy: oy + lx * sin + ly * cos,
    }
  }

  private drawSevenSegmentDigit(
    g: Phaser.GameObjects.Graphics,
    digit: number,
    anchorX: number,
    anchorY: number,
    dcx: number,
    dcy: number,
    dh: number,
    dw: number,
    cos: number,
    sin: number
  ): void {
    const m = BUOY_SEG7[Phaser.Math.Clamp(digit, 0, 9)] ?? 0
    const thick = Math.max(1.1, dh * 0.14)
    const line = (lx0: number, ly0: number, lx1: number, ly1: number) => {
      const a = this.debrisLocalToScreen(dcx + lx0, dcy + ly0, anchorX, anchorY, cos, sin)
      const b = this.debrisLocalToScreen(dcx + lx1, dcy + ly1, anchorX, anchorY, cos, sin)
      g.beginPath()
      g.moveTo(a.sx, a.sy)
      g.lineTo(b.sx, b.sy)
      g.strokePath()
    }
    g.lineStyle(thick, 0xffffff, 0.92)
    if (m & 1) line(-dw, -dh, dw, -dh)
    if (m & 2) line(dw, -dh + thick * 0.35, dw, -thick * 0.35)
    if (m & 4) line(dw, thick * 0.35, dw, dh - thick * 0.35)
    if (m & 8) line(-dw, dh, dw, dh)
    if (m & 16) line(-dw, thick * 0.35, -dw, dh - thick * 0.35)
    if (m & 32) line(-dw, -dh + thick * 0.35, -dw, -thick * 0.35)
    if (m & 64) line(-dw, 0, dw, 0)
  }

  /** Side-view channel buoy: wide float, open-frame tower, marked dayboard. */
  private drawNavBuoy(g: Phaser.GameObjects.Graphics, d: Debris, x: number, y: number): void {
    const s = d.size
    const cos = Math.cos(d.rotation)
    const sin = Math.sin(d.rotation)
    const T = (lx: number, ly: number) => this.debrisLocalToScreen(lx, ly, x, y, cos, sin)

    const baseCx = 0
    const baseCy = 0.42 * s
    const baseRx = 2.05 * s
    const baseRy = 0.46 * s
    const b0 = T(baseCx - baseRx, baseCy)
    const b1 = T(baseCx + baseRx, baseCy)
    const baseCenter = T(baseCx, baseCy)

    g.fillStyle(0x000000, 0.22)
    g.fillEllipse(baseCenter.sx + 3, baseCenter.sy + 4, baseRx * 2 + 4, baseRy * 2 + 2)

    g.fillStyle(d.color, 0.92)
    g.fillEllipse(baseCenter.sx, baseCenter.sy, baseRx * 2, baseRy * 2)
    g.lineStyle(1.2, 0x000000, 0.38)
    g.strokeEllipse(baseCenter.sx, baseCenter.sy, baseRx * 2, baseRy * 2)

    g.lineStyle(2, 0xf5f5f0, 0.55)
    g.beginPath()
    g.moveTo(b0.sx, b0.sy + baseRy * 0.55)
    g.lineTo(b1.sx, b1.sy + baseRy * 0.55)
    g.strokePath()

    const tx = 0.4 * s
    const yDeck = 0.02 * s
    const yTop = -2.12 * s
    const rungs = [-0.48 * s, -0.98 * s, -1.48 * s]
    const capH = 0.36 * s
    const capW = 1.05 * s
    const capBottom = yTop
    const capTop = yTop - capH

    g.lineStyle(1.35, 0x000000, 0.32)
    const post = (sign: number) => {
      const p0 = T(sign * tx, yDeck)
      const p1 = T(sign * tx, yTop)
      g.beginPath()
      g.moveTo(p0.sx, p0.sy)
      g.lineTo(p1.sx, p1.sy)
      g.strokePath()
    }
    post(-1)
    post(1)

    g.lineStyle(1.1, 0x000000, 0.42)
    for (const yr of rungs) {
      const a = T(-tx, yr)
      const b = T(tx, yr)
      g.beginPath()
      g.moveTo(a.sx, a.sy)
      g.lineTo(b.sx, b.sy)
      g.strokePath()
    }

    const c0 = T(-capW, capBottom)
    const c1 = T(capW, capBottom)
    const c2 = T(capW, capTop)
    const c3 = T(-capW, capTop)

    g.fillStyle(d.color, 0.95)
    g.beginPath()
    g.moveTo(c0.sx, c0.sy)
    g.lineTo(c1.sx, c1.sy)
    g.lineTo(c2.sx, c2.sy)
    g.lineTo(c3.sx, c3.sy)
    g.closePath()
    g.fillPath()
    g.lineStyle(1.4, 0x000000, 0.45)
    g.beginPath()
    g.moveTo(c0.sx, c0.sy)
    g.lineTo(c1.sx, c1.sy)
    g.lineTo(c2.sx, c2.sy)
    g.lineTo(c3.sx, c3.sy)
    g.closePath()
    g.strokePath()

    const mark = d.buoyMark ?? 44
    const d10 = Math.floor(mark / 10) % 10
    const d1 = mark % 10
    const dh = 0.13 * s
    const dw = 0.07 * s
    const digitY = (capBottom + capTop) * 0.5
    this.drawSevenSegmentDigit(g, d10, x, y, -0.2 * s, digitY, dh, dw, cos, sin)
    this.drawSevenSegmentDigit(g, d1, x, y, 0.2 * s, digitY, dh, dw, cos, sin)
  }

  private drawDebris(d: Debris, x: number, y: number): void {
    const g = this.debrisGraphics

    if (d.type !== 'buoy') {
      const sh = d.type === 'shard' ? 0.55 : 1
      g.fillStyle(0x000000, 0.2 * sh)
      g.fillEllipse(x + 3, y + 3, d.size * 2.5 * sh, d.size * 1.2 * sh)
    }

    switch (d.type) {
      case 'buoy':
        this.drawNavBuoy(g, d, x, y)
        break

      case 'shard': {
        const sc = Math.cos(d.rotation)
        const sn = Math.sin(d.rotation)
        const pw = d.size * 1.65
        const ph = d.size * 0.42
        const corners = [
          { x: -pw, y: -ph }, { x: pw, y: -ph },
          { x: pw, y: ph }, { x: -pw, y: ph },
        ].map(p => ({
          x: x + p.x * sc - p.y * sn,
          y: y + p.x * sn + p.y * sc,
        }))
        g.fillStyle(d.color, 0.78)
        g.beginPath()
        g.moveTo(corners[0].x, corners[0].y)
        corners.slice(1).forEach(c => g.lineTo(c.x, c.y))
        g.closePath()
        g.fillPath()
        g.lineStyle(0.85, 0x000000, 0.28)
        g.beginPath()
        g.moveTo(corners[0].x, corners[0].y)
        corners.slice(1).forEach(c => g.lineTo(c.x, c.y))
        g.closePath()
        g.strokePath()
        break
      }

      case 'plank': {
        const plankCos = Math.cos(d.rotation)
        const plankSin = Math.sin(d.rotation)
        const pw = d.size * 3
        const ph = d.size * 0.8
        const plankCorners = [
          { x: -pw, y: -ph }, { x: pw, y: -ph },
          { x: pw, y: ph }, { x: -pw, y: ph }
        ].map(p => ({
          x: x + p.x * plankCos - p.y * plankSin,
          y: y + p.x * plankSin + p.y * plankCos,
        }))
        g.fillStyle(d.color, 0.85)
        g.beginPath()
        g.moveTo(plankCorners[0].x, plankCorners[0].y)
        plankCorners.slice(1).forEach(c => g.lineTo(c.x, c.y))
        g.closePath()
        g.fillPath()
        g.lineStyle(1, 0x000000, 0.3)
        g.beginPath()
        g.moveTo(plankCorners[0].x, plankCorners[0].y)
        plankCorners.slice(1).forEach(c => g.lineTo(c.x, c.y))
        g.closePath()
        g.strokePath()
        break
      }

      case 'barrel':
        g.fillStyle(d.color, 0.88)
        g.fillEllipse(x, y, d.size * 2, d.size * 2.5)
        g.lineStyle(1.5, 0x000000, 0.4)
        g.strokeEllipse(x, y, d.size * 2, d.size * 2.5)
        g.lineStyle(1.5, 0x000000, 0.3)
        g.beginPath()
        g.moveTo(x - d.size * 0.8, y - d.size * 0.4)
        g.lineTo(x + d.size * 0.8, y - d.size * 0.4)
        g.moveTo(x - d.size * 0.8, y + d.size * 0.4)
        g.lineTo(x + d.size * 0.8, y + d.size * 0.4)
        g.strokePath()
        break
    }
  }

  setMapZoom(z: number): void {
    this.mapZoom = z
  }

  getLands(): readonly LandMass[] {
    return this.lands
  }

  resize(boatX: number, boatY: number): void {
    this.waveLines = []
    this.debris = []
    this.initWaveLines(boatX, boatY)
    this.initDebris(boatX, boatY)
  }

  destroy(): void {
    this.waterGraphics.destroy()
    this.landGraphics.destroy()
    this.debrisGraphics.destroy()
    this.zoneGraphics.destroy()
  }
}

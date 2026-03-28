import Phaser from 'phaser'
import { screenToWorld, worldToScreen } from './camera'
import { MAP_ZOOM_BASE, viewportHalfExtents } from './mapConfig'
import { WindZone } from './Wind'

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
  type: 'buoy' | 'plank' | 'barrel'
  color: number
  size: number
  rotation: number
  rotSpeed: number
}

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
  private debrisGraphics: Phaser.GameObjects.Graphics
  private zoneGraphics: Phaser.GameObjects.Graphics

  private debris: Debris[] = []
  private waveLines: WaveLine[] = []
  private waveOffset: number = 0

  /** World units → screen pixels (see mapConfig) */
  mapZoom: number

  constructor(scene: Phaser.Scene, mapZoom: number = MAP_ZOOM_BASE) {
    this.scene = scene
    this.mapZoom = mapZoom

    this.waterGraphics = scene.add.graphics()
    this.waterGraphics.setDepth(0)

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

    for (let i = 0; i < count; i++) {
      this.debris.push({
        worldX: boatX + (Math.random() * 2 - 1) * halfW,
        worldY: boatY + (Math.random() * 2 - 1) * halfH,
        type: debrisTypes[Math.floor(Math.random() * debrisTypes.length)],
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.random() * 8,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.5,
      })
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

    for (const d of this.debris) {
      d.rotation += d.rotSpeed * dt
      this.wrapWorldPoint(d, boatX, boatY, halfW, halfH)
    }

    this.draw(windDir, zones, boatX, boatY, waterFlowDir)
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

  private drawDebris(d: Debris, x: number, y: number): void {
    const g = this.debrisGraphics

    g.fillStyle(0x000000, 0.2)
    g.fillEllipse(x + 3, y + 3, d.size * 2.5, d.size * 1.2)

    switch (d.type) {
      case 'buoy':
        g.fillStyle(d.color, 0.9)
        g.fillCircle(x, y, d.size)
        g.lineStyle(1.5, 0x000000, 0.4)
        g.strokeCircle(x, y, d.size)
        g.lineStyle(2, 0xffffff, 0.6)
        g.beginPath()
        g.moveTo(x - d.size * 0.6, y)
        g.lineTo(x + d.size * 0.6, y)
        g.strokePath()
        break

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

  resize(boatX: number, boatY: number): void {
    this.waveLines = []
    this.debris = []
    this.initWaveLines(boatX, boatY)
    this.initDebris(boatX, boatY)
  }

  destroy(): void {
    this.waterGraphics.destroy()
    this.debrisGraphics.destroy()
    this.zoneGraphics.destroy()
  }
}

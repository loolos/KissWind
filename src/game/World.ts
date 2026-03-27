import Phaser from 'phaser'
import { worldToScreen } from './camera'
import { MAP_ZOOM } from './mapConfig'
import { WindZone } from './Wind'

/** Swell travel direction in world radians (+X = east). Not tied to wind. */
const WAVE_SWELL_DIR = Math.PI * 0.22

/** World-space drift speed scale (units/s), multiplied by each line’s random speed. */
const WAVE_DRIFT_SPEED = 1.1

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
  readonly mapZoom: number

  constructor(scene: Phaser.Scene, mapZoom: number = MAP_ZOOM) {
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
    const w = this.scene.scale.width
    const h = this.scene.scale.height
    const z = this.mapZoom
    const pad = 80 / z
    return {
      halfW: w / (2 * z) + pad,
      halfH: h / (2 * z) + pad,
    }
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
    zones: WindZone[]
  ): void {
    const { halfW, halfH } = this.viewportHalfExtents()

    // Fixed-direction swell (slow); shimmer time independent of wind
    this.waveOffset += dt * 1.2

    for (const wl of this.waveLines) {
      const step = WAVE_DRIFT_SPEED * wl.speed * dt
      wl.worldX += Math.cos(WAVE_SWELL_DIR) * step
      wl.worldY += Math.sin(WAVE_SWELL_DIR) * step
      this.wrapWorldPoint(wl, boatX, boatY, halfW, halfH)
    }

    for (const d of this.debris) {
      d.rotation += d.rotSpeed * dt
      this.wrapWorldPoint(d, boatX, boatY, halfW, halfH)
    }

    this.draw(windDir, zones, boatX, boatY)
  }

  private draw(windDir: number, zones: WindZone[], boatX: number, boatY: number): void {
    const w = this.scene.scale.width
    const h = this.scene.scale.height
    const z = this.mapZoom

    // Draw water background
    this.waterGraphics.clear()

    const gradColors = [
      { r: 10, g: 32, b: 80 },
      { r: 12, g: 38, b: 92 },
      { r: 14, g: 48, b: 104 },
      { r: 16, g: 58, b: 116 },
      { r: 18, g: 68, b: 128 },
      { r: 20, g: 80, b: 140 },
    ]
    for (let i = 0; i < 6; i++) {
      const c = gradColors[i]
      const color = Phaser.Display.Color.GetColor(c.r, c.g, c.b)
      this.waterGraphics.fillStyle(color, 1)
      this.waterGraphics.fillRect(0, i * (h / 6), w, h / 6 + 1)
    }

    for (const wl of this.waveLines) {
      const perpX = Math.cos(WAVE_SWELL_DIR + Math.PI / 2)
      const perpY = Math.sin(WAVE_SWELL_DIR + Math.PI / 2)
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

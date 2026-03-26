import Phaser from 'phaser'
import { WindZone } from './Wind'

interface Debris {
  screenX: number
  screenY: number
  type: 'buoy' | 'plank' | 'barrel'
  color: number
  size: number
  rotation: number
  rotSpeed: number
}

interface WaveLine {
  screenX: number
  screenY: number
  length: number
  alpha: number
  speed: number  // relative speed multiplier
}

export class World {
  private scene: Phaser.Scene
  private waterGraphics: Phaser.GameObjects.Graphics
  private debrisGraphics: Phaser.GameObjects.Graphics
  private zoneGraphics: Phaser.GameObjects.Graphics

  private debris: Debris[] = []
  private waveLines: WaveLine[] = []
  private waveOffset: number = 0

  // For world-space scrolling offsets
  offsetX: number = 0
  offsetY: number = 0

  constructor(scene: Phaser.Scene) {
    this.scene = scene

    this.waterGraphics = scene.add.graphics()
    this.waterGraphics.setDepth(0)

    this.zoneGraphics = scene.add.graphics()
    this.zoneGraphics.setDepth(2)

    this.debrisGraphics = scene.add.graphics()
    this.debrisGraphics.setDepth(3)

    this.initDebris()
    this.initWaveLines()
  }

  private initDebris(): void {
    const w = this.scene.scale.width
    const h = this.scene.scale.height
    const count = 8

    const debrisTypes: Array<'buoy' | 'plank' | 'barrel'> = ['buoy', 'plank', 'barrel']
    const colors = [0xff6633, 0xaa8855, 0x886644, 0xffaa33, 0xcc4422]

    for (let i = 0; i < count; i++) {
      this.debris.push({
        screenX: Math.random() * w,
        screenY: Math.random() * h,
        type: debrisTypes[Math.floor(Math.random() * debrisTypes.length)],
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.random() * 8,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.5,
      })
    }
  }

  private initWaveLines(): void {
    const w = this.scene.scale.width
    const h = this.scene.scale.height
    const count = 35

    for (let i = 0; i < count; i++) {
      this.waveLines.push({
        screenX: Math.random() * w,
        screenY: Math.random() * h,
        length: 20 + Math.random() * 60,
        alpha: 0.05 + Math.random() * 0.15,
        speed: 0.5 + Math.random() * 1.0,
      })
    }
  }

  update(
    dt: number,
    boatVx: number,
    boatVy: number,
    windDir: number,
    windStrength: number,
    zones: WindZone[]
  ): void {
    const w = this.scene.scale.width
    const h = this.scene.scale.height

    // Update world offset (moves opposite to boat)
    this.offsetX -= boatVx * dt
    this.offsetY -= boatVy * dt

    // Update wave lines - drift in wind direction
    const waveSpeed = windStrength * 25 * dt
    this.waveOffset += waveSpeed

    for (const wl of this.waveLines) {
      wl.screenX -= boatVx * dt + Math.cos(windDir) * wl.speed * waveSpeed * 0.5
      wl.screenY -= boatVy * dt + Math.sin(windDir) * wl.speed * waveSpeed * 0.5

      // Wrap around screen
      if (wl.screenX < -100) wl.screenX += w + 200
      if (wl.screenX > w + 100) wl.screenX -= w + 200
      if (wl.screenY < -100) wl.screenY += h + 200
      if (wl.screenY > h + 100) wl.screenY -= h + 200
    }

    // Update debris
    for (const d of this.debris) {
      d.screenX -= boatVx * dt
      d.screenY -= boatVy * dt
      d.rotation += d.rotSpeed * dt

      // Wrap around screen
      if (d.screenX < -60) d.screenX += w + 120
      if (d.screenX > w + 60) d.screenX -= w + 120
      if (d.screenY < -60) d.screenY += h + 120
      if (d.screenY > h + 60) d.screenY -= h + 120
    }

    this.draw(windDir, zones)
  }

  private draw(windDir: number, zones: WindZone[]): void {
    const w = this.scene.scale.width
    const h = this.scene.scale.height
    const cx = w / 2
    const cy = h / 2

    // Draw water background
    this.waterGraphics.clear()

    // Base ocean gradient (simulate with bands)
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

    // Draw wave lines
    for (const wl of this.waveLines) {
      // Wave line perpendicular to wind direction
      const perpX = Math.cos(windDir + Math.PI / 2)
      const perpY = Math.sin(windDir + Math.PI / 2)
      const half = wl.length / 2

      // Subtle shimmer
      const shimmer = Math.sin(wl.screenX * 0.05 + wl.screenY * 0.03 + this.waveOffset * 0.1) * 0.05

      this.waterGraphics.lineStyle(1.5, 0x88bbdd, wl.alpha + shimmer)
      this.waterGraphics.beginPath()
      this.waterGraphics.moveTo(wl.screenX - perpX * half, wl.screenY - perpY * half)
      this.waterGraphics.lineTo(wl.screenX + perpX * half, wl.screenY + perpY * half)
      this.waterGraphics.strokePath()
    }

    // Draw wind zones
    this.zoneGraphics.clear()
    for (const zone of zones) {
      // Convert world position to screen position
      const sx = cx + (zone.worldX + this.offsetX)
      const sy = cy + (zone.worldY + this.offsetY)

      // Only draw if on screen
      if (sx < -zone.radius * 2 || sx > w + zone.radius * 2) continue
      if (sy < -zone.radius * 2 || sy > h + zone.radius * 2) continue

      const color = zone.type === 'gust' ? 0xffdd00 : 0x888888
      const alpha = 0.18

      // Outer glow
      this.zoneGraphics.fillStyle(color, alpha * 0.4)
      this.zoneGraphics.fillCircle(sx, sy, zone.radius * 1.3)

      // Main zone
      this.zoneGraphics.fillStyle(color, alpha)
      this.zoneGraphics.fillCircle(sx, sy, zone.radius)

      // Inner bright core
      this.zoneGraphics.fillStyle(color, alpha * 1.5)
      this.zoneGraphics.fillCircle(sx, sy, zone.radius * 0.4)

      // Border
      this.zoneGraphics.lineStyle(1.5, color, 0.5)
      this.zoneGraphics.strokeCircle(sx, sy, zone.radius)

      // Label
      if (zone.radius > 60) {
        // Draw tiny arrows for gust zones
        if (zone.type === 'gust') {
          this.drawArrow(this.zoneGraphics, sx, sy, windDir, 15, 0xffee88, 0.8)
          this.drawArrow(this.zoneGraphics, sx - 12, sy, windDir, 10, 0xffee88, 0.5)
          this.drawArrow(this.zoneGraphics, sx + 12, sy, windDir, 10, 0xffee88, 0.5)
        } else {
          // Dead zone: X mark
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

    // Draw debris
    this.debrisGraphics.clear()
    for (const d of this.debris) {
      this.drawDebris(d)
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

    // Arrowhead
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

  private drawDebris(d: Debris): void {
    const g = this.debrisGraphics
    const x = d.screenX
    const y = d.screenY

    // Shadow
    g.fillStyle(0x000000, 0.2)
    g.fillEllipse(x + 3, y + 3, d.size * 2.5, d.size * 1.2)

    switch (d.type) {
      case 'buoy':
        // Red/orange buoy
        g.fillStyle(d.color, 0.9)
        g.fillCircle(x, y, d.size)
        g.lineStyle(1.5, 0x000000, 0.4)
        g.strokeCircle(x, y, d.size)
        // Stripe
        g.lineStyle(2, 0xffffff, 0.6)
        g.beginPath()
        g.moveTo(x - d.size * 0.6, y)
        g.lineTo(x + d.size * 0.6, y)
        g.strokePath()
        break

      case 'plank': {
        // Wooden plank - manual rotation (no save/restore on Phaser Graphics)
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
        // Barrel shape
        g.fillStyle(d.color, 0.88)
        g.fillEllipse(x, y, d.size * 2, d.size * 2.5)
        g.lineStyle(1.5, 0x000000, 0.4)
        g.strokeEllipse(x, y, d.size * 2, d.size * 2.5)
        // Barrel rings
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

  resize(): void {
    this.waveLines = []
    this.initWaveLines()
  }

  destroy(): void {
    this.waterGraphics.destroy()
    this.debrisGraphics.destroy()
    this.zoneGraphics.destroy()
  }
}

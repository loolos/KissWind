import Phaser from 'phaser'
import { worldToScreen, screenToWorld } from './camera'
import { MAP_ZOOM_BASE, viewportHalfExtents } from './mapConfig'

/** Between debris (3) and boat (10). */
const DEPTH = 5

/** Seconds until next flock / breach attempt (randomized after each spawn). */
const BIRD_COOLDOWN_MIN = 2.2
const BIRD_COOLDOWN_MAX = 5.5
const BREACH_COOLDOWN_MIN = 3
const BREACH_COOLDOWN_MAX = 8

interface Bird {
  worldX: number
  worldY: number
  vx: number
  vy: number
  wingPhase: number
}

interface Breach {
  worldX: number
  worldY: number
  age: number
  duration: number
  kind: 'dolphin' | 'whale'
  /** Screen-space drift per second during arc. */
  driftPxPerSec: number
  facing: 1 | -1
  /** Peak screen jump (px); fixed at spawn so draw does not flicker. */
  peakPx: number
}

export class SeaLifeAmbience {
  private scene: Phaser.Scene
  private g: Phaser.GameObjects.Graphics

  private birds: Bird[] = []
  private breaches: Breach[] = []

  private birdCountdown = 0.4 + Math.random() * 1.4
  private breachCountdown = 0.8 + Math.random() * 2.2

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.g = scene.add.graphics()
    this.g.setDepth(DEPTH)
  }

  update(
    dt: number,
    boatX: number,
    boatY: number,
    mapZoom: number,
    viewW: number,
    viewH: number
  ): void {
    const { halfW, halfH } = viewportHalfExtents(viewW, viewH, mapZoom)
    const marginWorld = Math.max(70, halfW * 0.08) / mapZoom

    this.birdCountdown -= dt
    if (this.birdCountdown <= 0) {
      this.spawnBirdFlock(boatX, boatY, mapZoom, viewW, viewH, halfW, halfH, marginWorld)
      this.birdCountdown = BIRD_COOLDOWN_MIN + Math.random() * (BIRD_COOLDOWN_MAX - BIRD_COOLDOWN_MIN)
    }

    this.breachCountdown -= dt
    if (this.breachCountdown <= 0) {
      this.spawnBreach(boatX, boatY, mapZoom, viewW, viewH, halfW, halfH)
      this.breachCountdown = BREACH_COOLDOWN_MIN + Math.random() * (BREACH_COOLDOWN_MAX - BREACH_COOLDOWN_MIN)
    }

    for (const b of this.birds) {
      b.worldX += b.vx * dt
      b.worldY += b.vy * dt
      b.wingPhase += dt * 14
    }

    this.birds = this.birds.filter(b => this.birdOnScreen(b, boatX, boatY, mapZoom, viewW, viewH, halfW, halfH))

    for (const br of this.breaches) {
      br.age += dt
    }
    this.breaches = this.breaches.filter(br => br.age < br.duration)

    this.draw(boatX, boatY, mapZoom, viewW, viewH)
  }

  private spawnBirdFlock(
    boatX: number,
    boatY: number,
    mapZoom: number,
    viewW: number,
    viewH: number,
    halfW: number,
    halfH: number,
    marginWorld: number
  ): void {
    let wx: number
    let wy: number
    let dir: number

    const spanY = halfH * 0.75
    const spanX = halfW * 0.75
    const jitter = () => (Math.random() - 0.5) * 0.35

    /** Most birds: upper screen band (sky), fly straight across — reads clearly vs water. */
    if (Math.random() < 0.78) {
      const syPix = viewH * (0.05 + Math.random() * 0.22)
      const fromLeft = Math.random() < 0.5
      const sxPix = fromLeft ? -60 : viewW + 60
      const p = screenToWorld(sxPix, syPix, boatX, boatY, mapZoom, viewW, viewH)
      wx = p.wx
      wy = p.wy
      dir = fromLeft ? (Math.random() - 0.5) * 0.22 : Math.PI + (Math.random() - 0.5) * 0.22
    } else {
      const edge = Phaser.Math.Between(0, 3)
      switch (edge) {
        case 0:
          wx = boatX - halfW - marginWorld
          wy = boatY + (Math.random() * 2 - 1) * spanY
          dir = jitter()
          break
        case 1:
          wx = boatX + halfW + marginWorld
          wy = boatY + (Math.random() * 2 - 1) * spanY
          dir = Math.PI + jitter()
          break
        case 2:
          wx = boatX + (Math.random() * 2 - 1) * spanX
          wy = boatY - halfH - marginWorld
          dir = Math.PI / 2 + jitter()
          break
        default:
          wx = boatX + (Math.random() * 2 - 1) * spanX
          wy = boatY + halfH + marginWorld
          dir = -Math.PI / 2 + jitter()
      }
    }

    const speed = 14 + Math.random() * 18
    const vx = Math.cos(dir) * speed
    const vy = Math.sin(dir) * speed
    const perpX = -vy * 0.08
    const perpY = vx * 0.08

    const flockRoll = Math.random()
    const n = flockRoll < 0.28 ? 3 : flockRoll < 0.62 ? 2 : 1

    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) * 0.5) * 2.8
      this.birds.push({
        worldX: wx + perpX * t,
        worldY: wy + perpY * t,
        vx,
        vy,
        wingPhase: Math.random() * Math.PI * 2,
      })
    }
  }

  private spawnBreach(
    boatX: number,
    boatY: number,
    mapZoom: number,
    viewW: number,
    viewH: number,
    halfW: number,
    halfH: number
  ): void {
    const t = 0.35 + Math.random() * 0.3
    const sx = viewW * t + (Math.random() - 0.5) * viewW * 0.2
    const sy = viewH * t + (Math.random() - 0.5) * viewH * 0.15
    const { wx, wy } = screenToWorld(sx, sy, boatX, boatY, mapZoom, viewW, viewH)

    const kind: 'dolphin' | 'whale' = Math.random() < 0.62 ? 'dolphin' : 'whale'
    const duration = kind === 'whale' ? 1.35 + Math.random() * 0.45 : 0.85 + Math.random() * 0.35
    const zf = Phaser.Math.Clamp(mapZoom / MAP_ZOOM_BASE, 0.45, 1.35)
    const peakPx =
      kind === 'whale'
        ? (26 + 18 * zf) * (0.88 + Math.random() * 0.12)
        : (16 + 10 * zf) * (0.88 + Math.random() * 0.12)

    this.breaches.push({
      worldX: wx,
      worldY: wy,
      age: 0,
      duration,
      kind,
      driftPxPerSec: (Math.random() - 0.5) * 28,
      facing: Math.random() < 0.5 ? -1 : 1,
      peakPx,
    })
  }

  private birdOnScreen(
    b: Bird,
    boatX: number,
    boatY: number,
    mapZoom: number,
    viewW: number,
    viewH: number,
    halfW: number,
    halfH: number
  ): boolean {
    const p = worldToScreen(b.worldX, b.worldY, boatX, boatY, mapZoom, viewW, viewH)
    const pad = 80
    return p.sx > -pad && p.sx < viewW + pad && p.sy > -pad && p.sy < viewH + pad
  }

  private draw(boatX: number, boatY: number, mapZoom: number, viewW: number, viewH: number): void {
    this.g.clear()
    const zf = Phaser.Math.Clamp(mapZoom / MAP_ZOOM_BASE, 0.45, 1.35)

    for (const b of this.birds) {
      const { sx, sy } = worldToScreen(b.worldX, b.worldY, boatX, boatY, mapZoom, viewW, viewH)
      const base = Math.atan2(b.vy, b.vx)
      const flap = 0.28 + 0.42 * Math.abs(Math.sin(b.wingPhase))
      /** Bigger when map zoomed out so silhouettes stay readable (fish use world-anchored art). */
      const zoomBoost = Phaser.Math.Clamp(MAP_ZOOM_BASE / Math.max(mapZoom, 1.5), 1, 2.4)
      const wingLen = (11 + 7 * zf) * (0.92 + flap * 0.2) * zoomBoost
      const lf = base + Math.PI * 0.72 + flap * 0.22
      const rf = base - Math.PI * 0.72 - flap * 0.22
      const lx = sx + Math.cos(lf) * wingLen
      const ly = sy + Math.sin(lf) * wingLen
      const rx = sx + Math.cos(rf) * wingLen
      const ry = sy + Math.sin(rf) * wingLen

      // Filled silhouette: wing tips + “nose” toward flight dir (classic gull-from-below V).
      const noseX = sx + Math.cos(base) * wingLen * 0.3
      const noseY = sy + Math.sin(base) * wingLen * 0.3
      this.g.fillStyle(0x3d4658, 0.92)
      this.g.beginPath()
      this.g.moveTo(lx, ly)
      this.g.lineTo(rx, ry)
      this.g.lineTo(noseX, noseY)
      this.g.closePath()
      this.g.fillPath()

      this.g.lineStyle(2.1, 0x2a3344, 1)
      this.g.beginPath()
      this.g.moveTo(sx, sy)
      this.g.lineTo(lx, ly)
      this.g.moveTo(sx, sy)
      this.g.lineTo(rx, ry)
      this.g.strokePath()

      this.g.fillStyle(0x252a36, 0.98)
      this.g.fillCircle(noseX, noseY, Math.max(2.2, 3.2 * zf * zoomBoost * 0.45))
    }

    for (const br of this.breaches) {
      const u = br.age / br.duration
      const base = worldToScreen(br.worldX, br.worldY, boatX, boatY, mapZoom, viewW, viewH)
      const hop = Math.sin(Math.PI * u) * br.peakPx
      const drift = (u - 0.5) * br.driftPxPerSec * br.duration * 0.02
      const sx = base.sx + drift * br.facing
      const sy = base.sy - hop
      const bob = Math.sin(u * Math.PI * 2) * 1.2

      if (br.kind === 'dolphin') {
        const bodyLen = 14 + 8 * zf
        const thick = 4.5 * zf
        const cx = sx - br.facing * bodyLen * 0.18
        const cy = sy + bob
        this.g.fillStyle(0x3a4a62, 0.92)
        this.g.fillEllipse(cx, cy, bodyLen, thick * 2)
        this.g.lineStyle(1.2, 0x1c2838, 0.75)
        this.g.strokeEllipse(cx, cy, bodyLen, thick * 2)
        const tailX = cx - br.facing * bodyLen * 0.42
        const tailY = cy + bob * 0.5
        this.g.fillStyle(0x2d3d52, 0.9)
        this.g.beginPath()
        this.g.moveTo(tailX, tailY)
        this.g.lineTo(tailX - br.facing * bodyLen * 0.32, tailY - thick * 1.05)
        this.g.lineTo(tailX - br.facing * bodyLen * 0.32, tailY + thick * 1.05)
        this.g.closePath()
        this.g.fillPath()
        const snX = cx + br.facing * bodyLen * 0.38
        const snY = cy - thick * 0.4
        this.g.fillStyle(0x4a5c78, 0.85)
        this.g.beginPath()
        this.g.moveTo(snX, snY)
        this.g.lineTo(snX + br.facing * thick * 1.1, snY - thick * 0.5)
        this.g.lineTo(snX + br.facing * thick * 0.35, snY + thick * 0.2)
        this.g.closePath()
        this.g.fillPath()
      } else {
        const bodyLen = 22 + 12 * zf
        const thick = 7 * zf
        const cx = sx - br.facing * bodyLen * 0.16
        const cy = sy + bob * 0.6
        this.g.fillStyle(0x2c3848, 0.94)
        this.g.fillEllipse(cx, cy, bodyLen, thick * 2)
        this.g.lineStyle(1.5, 0x141c28, 0.7)
        this.g.strokeEllipse(cx, cy, bodyLen, thick * 2)
        const flukeX = cx - br.facing * bodyLen * 0.44
        const flukeY = cy + bob * 0.35
        this.g.fillStyle(0x252e3c, 0.92)
        this.g.beginPath()
        this.g.moveTo(flukeX, flukeY)
        this.g.lineTo(flukeX - br.facing * bodyLen * 0.26, flukeY - thick * 1.05)
        this.g.lineTo(flukeX - br.facing * bodyLen * 0.2, flukeY)
        this.g.lineTo(flukeX - br.facing * bodyLen * 0.26, flukeY + thick * 1.05)
        this.g.closePath()
        this.g.fillPath()

        if (u > 0.38 && u < 0.62) {
          const sp = (u - 0.38) / 0.24
          const mistA = Math.sin(Math.PI * sp) * 0.55
          const bx = cx + br.facing * bodyLen * 0.38
          const by = cy - thick * 1.05
          this.g.fillStyle(0xc8dce8, mistA * 0.5)
          this.g.fillCircle(bx, by - 4 * zf, 3.5 * zf)
          this.g.fillCircle(bx + 2 * br.facing, by - 7 * zf, 2.5 * zf)
        }

        const splash = Math.sin(Math.PI * u)
        if (splash > 0.15 && splash < 0.95) {
          this.g.lineStyle(1.8, 0xa8c8e8, splash * 0.35)
          this.g.beginPath()
          this.g.arc(sx, base.sy + 2, 10 * zf * splash, 0.2, Math.PI - 0.2, false)
          this.g.strokePath()
        }
      }
    }
  }

  destroy(): void {
    this.g.destroy()
  }
}

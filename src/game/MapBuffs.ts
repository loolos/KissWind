import Phaser from 'phaser'
import { worldToScreen } from './camera'
import { viewportHalfExtents } from './mapConfig'
import { isPointOnAnyLand } from './land'
import type { FixedRouteMap } from './fixedMap'

export type BuffKind = 'windBoost'

interface Pickup {
  worldX: number
  worldY: number
  kind: BuffKind
}

interface PendingRespawn {
  timeLeft: number
  kind: BuffKind
}

const TARGET_ON_MAP = 1
const PICKUP_RADIUS_WORLD = 18
const LAND_MARGIN = 12
const RESPAWN_SEC_MIN = 22
const RESPAWN_SEC_MAX = 48
const START_FINISH_CLEAR = 52
const GUST_DURATION_SEC = 0.85
const GUST_LINE_COUNT = 16

function smoothstep(t: number): number {
  const x = Phaser.Math.Clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

export class MapBuffPickups {
  private readonly scene: Phaser.Scene
  private readonly routeMap: FixedRouteMap
  private pickups: Pickup[] = []
  private pending: PendingRespawn[] = []
  private readonly gfx: Phaser.GameObjects.Graphics
  private readonly gustGfx: Phaser.GameObjects.Graphics
  private gustRemainingSec = 0
  private gustWindDir = 0
  private gustAnimT = 0

  constructor(scene: Phaser.Scene, routeMap: FixedRouteMap) {
    this.scene = scene
    this.routeMap = routeMap
    this.gfx = scene.add.graphics()
    this.gfx.setDepth(3.5)
    this.gustGfx = scene.add.graphics()
    this.gustGfx.setDepth(19)
  }

  bootstrap(boatX: number, boatY: number, viewW: number, viewH: number, mapZoom: number): void {
    while (this.pickups.length < TARGET_ON_MAP) {
      if (!this.spawnOne(boatX, boatY, viewW, viewH, mapZoom)) break
    }
  }

  /**
   * Try pickup at up to two positions (e.g. pre/post physics) so fast boats still register.
   * @returns kind if any pickup consumed this call.
   */
  tryCollectAt(boatX: number, boatY: number, x2?: number, y2?: number): BuffKind | null {
    const tryOne = (bx: number, by: number): BuffKind | null => {
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const p = this.pickups[i]
        const d = Math.hypot(p.worldX - bx, p.worldY - by)
        if (d <= PICKUP_RADIUS_WORLD) {
          this.pickups.splice(i, 1)
          this.pending.push({
            timeLeft: Phaser.Math.FloatBetween(RESPAWN_SEC_MIN, RESPAWN_SEC_MAX),
            kind: p.kind,
          })
          return p.kind
        }
      }
      return null
    }
    const a = tryOne(boatX, boatY)
    if (a) return a
    if (x2 !== undefined && y2 !== undefined) return tryOne(x2, y2)
    return null
  }

  triggerGust(windDir: number): void {
    this.gustRemainingSec = GUST_DURATION_SEC
    this.gustWindDir = windDir
    this.gustAnimT = 0
  }

  update(
    dt: number,
    boatX: number,
    boatY: number,
    viewW: number,
    viewH: number,
    mapZoom: number
  ): void {
    const { halfW, halfH } = viewportHalfExtents(viewW, viewH, mapZoom)

    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i].timeLeft -= dt
      if (this.pending[i].timeLeft <= 0) {
        const kind = this.pending[i].kind
        this.pending.splice(i, 1)
        this.spawnOneOfKind(boatX, boatY, viewW, viewH, mapZoom, kind)
      }
    }

    for (const p of this.pickups) {
      this.wrapWorldPoint(p, boatX, boatY, halfW, halfH)
    }

    while (this.pickups.length < TARGET_ON_MAP) {
      if (!this.spawnOne(boatX, boatY, viewW, viewH, mapZoom)) break
    }

    if (this.gustRemainingSec > 0) {
      this.gustRemainingSec -= dt
      this.gustAnimT += dt * 9
      this.drawGust(viewW, viewH)
    } else {
      this.gustGfx.clear()
    }

    this.drawPickups(boatX, boatY, viewW, viewH, mapZoom)
  }

  private lands() {
    return this.routeMap.lands
  }

  private spawnOne(
    boatX: number,
    boatY: number,
    viewW: number,
    viewH: number,
    mapZoom: number
  ): boolean {
    return this.spawnOneOfKind(boatX, boatY, viewW, viewH, mapZoom, 'windBoost')
  }

  private spawnOneOfKind(
    boatX: number,
    boatY: number,
    viewW: number,
    viewH: number,
    mapZoom: number,
    kind: BuffKind
  ): boolean {
    const pos = this.randomOpenWorldPoint(boatX, boatY, viewW, viewH, mapZoom)
    if (!pos) return false
    this.pickups.push({ worldX: pos.x, worldY: pos.y, kind })
    return true
  }

  private randomOpenWorldPoint(
    boatX: number,
    boatY: number,
    viewW: number,
    viewH: number,
    mapZoom: number
  ): { x: number; y: number } | null {
    const { halfW, halfH } = viewportHalfExtents(viewW, viewH, mapZoom)
    const lands = this.lands()
    const sx = this.routeMap.start.worldX
    const sy = this.routeMap.start.worldY
    const fx = this.routeMap.finish.worldX
    const fy = this.routeMap.finish.worldY
    const fr = this.routeMap.finish.radius

    for (let a = 0; a < 55; a++) {
      const x = boatX + (Math.random() * 2 - 1) * halfW
      const y = boatY + (Math.random() * 2 - 1) * halfH
      if (isPointOnAnyLand(lands, x, y, LAND_MARGIN)) continue
      if (Math.hypot(x - sx, y - sy) < START_FINISH_CLEAR) continue
      if (Math.hypot(x - fx, y - fy) < START_FINISH_CLEAR + fr) continue
      return { x, y }
    }
    return null
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

  private drawPickups(
    boatX: number,
    boatY: number,
    viewW: number,
    viewH: number,
    mapZoom: number
  ): void {
    const g = this.gfx
    g.clear()
    const t = this.scene.time.now / 1000
    const pulse = 0.92 + Math.sin(t * 5) * 0.08

    for (const p of this.pickups) {
      if (p.kind !== 'windBoost') continue
      const { sx, sy } = worldToScreen(p.worldX, p.worldY, boatX, boatY, mapZoom, viewW, viewH)
      if (sx < -40 || sy < -40 || sx > viewW + 40 || sy > viewH + 40) continue

      const scale = Phaser.Math.Clamp(0.42 * mapZoom, 2.8, 14) * pulse
      const rot = t * 0.35
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)

      const local: [number, number][] = [
        [0, -11],
        [3.5, -3],
        [-1.2, -4.5],
        [5.5, 6.5],
        [-2.8, 5.2],
        [1.2, 12],
      ]

      g.lineStyle(scale * 0.35, 0x1a1040, 0.95)
      g.beginPath()
      for (let i = 0; i < local.length; i++) {
        const [lx, ly] = local[i]
        const rx = lx * cos - ly * sin
        const ry = lx * sin + ly * cos
        if (i === 0) g.moveTo(sx + rx, sy + ry)
        else g.lineTo(sx + rx, sy + ry)
      }
      g.strokePath()

      g.lineStyle(scale * 0.22, 0xfff6a8, 1)
      g.beginPath()
      for (let i = 0; i < local.length; i++) {
        const [lx, ly] = local[i]
        const rx = lx * cos - ly * sin
        const ry = lx * sin + ly * cos
        if (i === 0) g.moveTo(sx + rx, sy + ry)
        else g.lineTo(sx + rx, sy + ry)
      }
      g.strokePath()
    }
  }

  private drawGust(viewW: number, viewH: number): void {
    const g = this.gustGfx
    g.clear()
    const fade = smoothstep(this.gustRemainingSec / GUST_DURATION_SEC)
    const alpha = fade * 0.42
    if (alpha < 0.02) return

    const wx = Math.cos(this.gustWindDir)
    const wy = Math.sin(this.gustWindDir)
    const px = -wy
    const py = wx
    const cx = viewW * 0.5
    const cy = viewH * 0.5
    const span = Math.min(viewW, viewH) * 0.48

    for (let i = 0; i < GUST_LINE_COUNT; i++) {
      const u = (i / GUST_LINE_COUNT) * 2 - 1
      const jitter = Math.sin(i * 2.17 + this.gustAnimT * 1.3) * 0.22
      const perp = (u + jitter) * span
      const along = ((i * 53 + this.gustAnimT * 42) % 140) - 70
      const x0 = cx + px * perp - wx * along * 0.85
      const y0 = cy + py * perp - wy * along * 0.85
      const len = 28 + (i % 5) * 8
      const x1 = x0 + wx * len
      const y1 = y0 + wy * len
      g.lineStyle(2, 0xc8e8ff, alpha * (0.35 + (i % 3) * 0.12))
      g.beginPath()
      g.moveTo(x0, y0)
      g.lineTo(x1, y1)
      g.strokePath()
    }
  }
}

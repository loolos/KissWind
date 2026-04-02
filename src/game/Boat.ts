import Phaser from 'phaser'
import { MAP_ZOOM_BASE } from './mapConfig'
import { normalizeAngle, SailQuality } from './Physics'

/** Time to rotate sail by 90° toward target (seconds). */
const SAIL_90_DEG_DURATION_SEC = 2
const SAIL_MAX_ROTATE_RAD_PER_SEC = (Math.PI / 2) / SAIL_90_DEG_DURATION_SEC
const SAIL_ANGLE_SNAP_EPS = 1e-5
import { BASE_WIND } from './Wind'

/** Stern spray appears from this ground speed upward (7× base wind scale). */
const SPRAY_SPEED_SMALL = BASE_WIND * 7
/** Larger foam / spray from this speed (10× base wind scale). */
const SPRAY_SPEED_LARGE = BASE_WIND * 10

/** Hull, mast, sail, strokes, and wake scale in the gameplay view (1 = original size). */
export const BOAT_VIS_SCALE = 2.1

/** Matches `hullLength / 2` in `draw` (56 × visScale → half-length along x before second `visScale` in `projWorld`). */
const HULL_HALF_LENGTH_UNITS = 28

/**
 * Camera ~30° above horizontal: deck fore-aft is foreshortened; mast/sail height maps to screen Y.
 * (Line of sight depressed from horizontal by this angle.)
 */
const CAMERA_ELEV = Math.PI / 6

const CE_COS = Math.cos(CAMERA_ELEV)
const CE_SIN = Math.sin(CAMERA_ELEV)

/** Hull (dark blue + cream deck). */
const HULL_BODY = 0x1e4477
const HULL_OUTLINE = 0x0d2644
const DECK_FILL = 0xecd9b8
const DECK_LINE = 0x88c4ee
const STRIPE_PINK = 0xe88a9a
const MAST_BODY = 0x2a4a7a
const MAST_CAP = 0x4a7acc
const RAINBOW_BANDS = [0xff6b6b, 0xffb74d, 0xffeb3b, 0x66bb6a, 0x4fc3f7, 0x9575cd] as const

export class Boat {
  private scene: Phaser.Scene
  private graphics: Phaser.GameObjects.Graphics
  private trailGraphics: Phaser.GameObjects.Graphics

  sailAngle: number
  /** Player command; `sailAngle` eases toward this. */
  targetSailAngle: number
  heading: number
  sailQuality: SailQuality = 'yellow'
  speed: number = 0

  private trailPoints: { x: number; y: number }[] = []
  private trailTimer: number = 0
  /** Animates stern spray / foam phase. */
  private wakeAnimT = 0
  /** BOAT_VIS_SCALE × (mapZoom / MAP_ZOOM_BASE)^0.3; zoom out → smaller boat, gentler than sqrt. */
  private visScale: number = BOAT_VIS_SCALE

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.heading = 0
    this.sailAngle = Math.PI / 4
    this.targetSailAngle = this.sailAngle

    this.trailGraphics = scene.add.graphics()
    this.trailGraphics.setDepth(1)

    this.graphics = scene.add.graphics()
    this.graphics.setDepth(10)
  }

  setSailAngle(angle: number): void {
    this.sailAngle = angle
    this.targetSailAngle = angle
  }

  /** Move `sailAngle` toward `targetSailAngle` along shortest arc, capped angular speed. */
  stepSailTowardTarget(dt: number): void {
    let err = normalizeAngle(this.targetSailAngle - this.sailAngle)
    if (Math.abs(err) <= SAIL_ANGLE_SNAP_EPS) {
      this.sailAngle = this.targetSailAngle
      return
    }
    const maxStep = SAIL_MAX_ROTATE_RAD_PER_SEC * dt
    if (err > maxStep) err = maxStep
    else if (err < -maxStep) err = -maxStep
    this.sailAngle += err
  }

  /** World horizontal offset from boat center → screen (Phaser y down). */
  private projWorld(wx: number, wy: number, wz: number, cx: number, cy: number): { x: number; y: number } {
    const S = this.visScale
    return {
      x: cx + wx * S,
      y: cy + wy * S * CE_COS - wz * S * CE_SIN,
    }
  }

  update(dt: number, heading: number, speed: number, quality: SailQuality, mapZoom: number): void {
    this.heading = heading
    this.speed = speed
    this.sailQuality = quality
    this.visScale = BOAT_VIS_SCALE * Math.pow(mapZoom / MAP_ZOOM_BASE, 0.3)

    this.trailTimer += dt
    if (this.trailTimer > 0.05) {
      this.trailTimer = 0
      const cx = this.scene.scale.width / 2
      const cy = this.scene.scale.height / 2
      this.trailPoints.push({ x: cx, y: cy })
      if (this.trailPoints.length > 30) {
        this.trailPoints.shift()
      }
    }

    this.wakeAnimT += dt * (5 + this.speed * 0.4)

    this.draw()
  }

  /** Foam / spray astern; `wakeAngle` points toward the wake (stern direction). */
  private drawSternSpray(cx: number, cy: number, wakeAngle: number): void {
    const g = this.trailGraphics
    const t = this.wakeAnimT
    const large = this.speed >= SPRAY_SPEED_LARGE
    const S = this.visScale
    /** Matches hull fore–aft span used in `draw` (world units × scale). */
    const hullLen = 56 * S
    /** Aft of boat center: near-stern offset + ¼ hull (was ½ hull; nudged forward ¼ hull). */
    const sternDist = 24 * S + hullLen * 0.25
    const sx = cx + Math.cos(wakeAngle) * sternDist
    const sy = cy + Math.sin(wakeAngle) * sternDist
    const perp = wakeAngle + Math.PI / 2

    const nDots = large ? 11 : 7
    for (let i = 0; i < nDots; i++) {
      const ph = t * 2.2 + i * 1.63
      const spread = (i - (nDots - 1) * 0.5) * 5.2 * S
      const px = sx + Math.cos(perp) * spread + Math.sin(ph) * 6.5 * S
      const py = sy + Math.sin(perp) * spread + Math.cos(ph * 0.88) * 5 * S
      const r = (large ? 4.1 : 2.9) * S + Math.sin(ph * 1.7) * 0.55 * S
      g.fillStyle(0xc8e8ff, large ? 0.52 : 0.4)
      g.fillCircle(px, py, r)
    }

    if (large) {
      for (let j = 0; j < 6; j++) {
        const ph2 = t * 1.55 + j * 2.1
        const back = (12 + j * 7.5) * S
        const bx = sx + Math.cos(wakeAngle) * back
        const by = sy + Math.sin(wakeAngle) * back
        const wob = Math.sin(ph2) * 7 * S
        g.fillStyle(0xffffff, 0.26 + (j % 2) * 0.09)
        g.fillEllipse(
          bx + Math.cos(perp) * wob,
          by + Math.sin(perp) * wob * 0.6,
          (17 + j * 1.1) * S,
          (10 + j * 0.75) * S
        )
      }
      g.lineStyle(1.45 * S, 0xffffff, 0.32)
      g.beginPath()
      const arcR = 22 * S
      const ax = sx + Math.cos(wakeAngle) * (16 * S)
      const ay = sy + Math.sin(wakeAngle) * (16 * S)
      g.arc(ax, ay, arcR, wakeAngle - 0.58, wakeAngle + 0.58, false)
      g.strokePath()
    }
  }

  private draw(): void {
    const cx = this.scene.scale.width / 2
    const cy = this.scene.scale.height / 2

    this.trailGraphics.clear()
    if (this.speed > 0.3) {
      const wakeAngle = this.heading + Math.PI
      const wakeSegs = Math.round(
        Phaser.Math.Clamp(10 + this.speed * 1.35, 10, 52)
      )
      const distStep = Phaser.Math.Clamp(3.2 + this.speed * 0.42, 3.2, 13) * this.visScale
      for (let side = -1; side <= 1; side += 2) {
        this.trailGraphics.lineStyle(1.5 * this.visScale, 0xaaddff, 0.3)
        this.trailGraphics.beginPath()
        let first = true
        for (let i = 0; i < wakeSegs; i++) {
          const t = wakeSegs > 1 ? i / (wakeSegs - 1) : 0
          const dist = i * distStep
          const spreadAngle = wakeAngle + side * t * 0.35
          const wx = cx + Math.cos(spreadAngle) * dist
          const wy = cy + Math.sin(spreadAngle) * dist
          if (first) {
            this.trailGraphics.moveTo(wx, wy)
            first = false
          } else this.trailGraphics.lineTo(wx, wy)
        }
        this.trailGraphics.strokePath()
      }

      if (this.speed >= SPRAY_SPEED_SMALL) {
        this.drawSternSpray(cx, cy, wakeAngle)
      }
    }

    this.graphics.clear()
    const g = this.graphics

    const hullLength = 56 * this.visScale
    const hullWidth = 12 * this.visScale
    const mastHeight = 58 * this.visScale

    const hullPoints = this.buildHull(hullLength, hullWidth)
    const rotatedHull = hullPoints.map(p => this.rotatePoint(p.x, p.y, this.heading))
    const innerHull = hullPoints.map(p =>
      this.rotatePoint(p.x * 0.72, p.y * 0.72, this.heading)
    )

    const sh = 3 * this.visScale
    g.fillStyle(0x000000, 0.22)
    g.beginPath()
    {
      const p0 = this.projWorld(rotatedHull[0].x, rotatedHull[0].y, 0, cx, cy)
      g.moveTo(p0.x + sh, p0.y + sh)
      for (let i = 1; i < rotatedHull.length; i++) {
        const p = this.projWorld(rotatedHull[i].x, rotatedHull[i].y, 0, cx, cy)
        g.lineTo(p.x + sh, p.y + sh)
      }
    }
    g.closePath()
    g.fillPath()

    g.fillStyle(HULL_BODY, 1)
    g.beginPath()
    {
      const p0 = this.projWorld(rotatedHull[0].x, rotatedHull[0].y, 0, cx, cy)
      g.moveTo(p0.x, p0.y)
      for (let i = 1; i < rotatedHull.length; i++) {
        const p = this.projWorld(rotatedHull[i].x, rotatedHull[i].y, 0, cx, cy)
        g.lineTo(p.x, p.y)
      }
    }
    g.closePath()
    g.fillPath()

    g.fillStyle(DECK_FILL, 1)
    g.beginPath()
    {
      const p0 = this.projWorld(innerHull[0].x, innerHull[0].y, 0, cx, cy)
      g.moveTo(p0.x, p0.y)
      for (let i = 1; i < innerHull.length; i++) {
        const p = this.projWorld(innerHull[i].x, innerHull[i].y, 0, cx, cy)
        g.lineTo(p.x, p.y)
      }
    }
    g.closePath()
    g.fillPath()

    const bow = this.rotatePoint(hullLength * 0.35, 0, this.heading)
    const stern = this.rotatePoint(-hullLength * 0.35, 0, this.heading)
    g.lineStyle(1.2 * this.visScale, DECK_LINE, 0.55)
    {
      const a = this.projWorld(bow.x * 0.55, bow.y * 0.55, 0, cx, cy)
      const b = this.projWorld(stern.x * 0.55, stern.y * 0.55, 0, cx, cy)
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.lineTo(b.x, b.y)
      g.strokePath()
    }
    {
      const a = this.projWorld(bow.x * 0.35, bow.y * 0.35, 0, cx, cy)
      const b = this.projWorld(stern.x * 0.35, stern.y * 0.35, 0, cx, cy)
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.lineTo(b.x, b.y)
      g.strokePath()
    }

    g.lineStyle(2 * this.visScale, HULL_OUTLINE, 1)
    g.beginPath()
    {
      const p0 = this.projWorld(rotatedHull[0].x, rotatedHull[0].y, 0, cx, cy)
      g.moveTo(p0.x, p0.y)
      for (let i = 1; i < rotatedHull.length; i++) {
        const p = this.projWorld(rotatedHull[i].x, rotatedHull[i].y, 0, cx, cy)
        g.lineTo(p.x, p.y)
      }
    }
    g.closePath()
    g.strokePath()

    const mastX = 5 * this.visScale
    const mastBaseOff = this.rotatePoint(mastX, 0, this.heading)
    const mast_wx = mastBaseOff.x
    const mast_wy = mastBaseOff.y

    let sailColor: number
    let sailAlpha: number
    let accentColor: number
    switch (this.sailQuality) {
      case 'green':
        sailColor = 0x44dd88
        sailAlpha = 0.92
        accentColor = 0x7cf0b0
        break
      case 'yellow':
        sailColor = 0xffdd44
        sailAlpha = 0.92
        accentColor = 0xfff08a
        break
      case 'gray':
        sailColor = 0x9aa0a8
        sailAlpha = 0.88
        accentColor = 0xc7ced9
        break
    }

    const beamUx = Math.cos(this.heading + Math.PI / 2)
    const beamUy = Math.sin(this.heading + Math.PI / 2)
    const clewDist = 56 * this.visScale

    const clew_wx = mast_wx + Math.cos(this.sailAngle) * clewDist
    const clew_wy = mast_wy + Math.sin(this.sailAngle) * clewDist

    const toClewX = clew_wx - mast_wx
    const toClewY = clew_wy - mast_wy
    const pullStarboard = toClewX * beamUx + toClewY * beamUy > 0
    const fullHalf = hullWidth * 0.52
    const smallHalf = fullHalf * 0.36
    let portDist: number
    let starDist: number
    if (pullStarboard) {
      portDist = smallHalf
      starDist = fullHalf
    } else {
      portDist = fullHalf
      starDist = smallHalf
    }

    const footPort_wx = mast_wx - beamUx * portDist
    const footPort_wy = mast_wy - beamUy * portDist
    const footStar_wx = mast_wx + beamUx * starDist
    const footStar_wy = mast_wy + beamUy * starDist

    const mastTop = this.projWorld(mast_wx, mast_wy, mastHeight, cx, cy)
    const mastBase = this.projWorld(mast_wx, mast_wy, 0, cx, cy)

    const drawSailTri = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      cx2: number,
      cy2: number,
      fill: number,
      alpha: number
    ): void => {
      g.fillStyle(fill, alpha)
      g.beginPath()
      g.moveTo(ax, ay)
      g.lineTo(bx, by)
      g.lineTo(cx2, cy2)
      g.closePath()
      g.fillPath()
      g.lineStyle(1.5 * this.visScale, 0x000000, 0.45)
      g.beginPath()
      g.moveTo(ax, ay)
      g.lineTo(bx, by)
      g.lineTo(cx2, cy2)
      g.closePath()
      g.strokePath()
    }

    const drawStripes = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      cx2: number,
      cy2: number,
      mainColor: number,
      alpha: number
    ): void => {
      const stripeColors =
        this.sailQuality === 'gray'
          ? [STRIPE_PINK, mainColor, accentColor, STRIPE_PINK, mainColor]
          : RAINBOW_BANDS
      for (let s = 0; s < stripeColors.length; s++) {
        const t = 0.16 + s * 0.11
        const q1x = ax + t * (cx2 - ax)
        const q1y = ay + t * (cy2 - ay)
        const q2x = bx + t * (cx2 - bx)
        const q2y = by + t * (cy2 - by)
        g.lineStyle(1.1 * this.visScale, stripeColors[s], 0.58 * alpha)
        g.beginPath()
        g.moveTo(q1x, q1y)
        g.lineTo(q2x, q2y)
        g.strokePath()
      }

      const centerT = 0.42
      const centerU = 0.48
      const px = ax + centerT * (cx2 - ax) + (bx - ax) * centerU * 0.35
      const py = ay + centerT * (cy2 - ay) + (by - ay) * centerU * 0.35
      g.fillStyle(accentColor, 0.5 * alpha)
      g.fillCircle(px, py, 2.2 * this.visScale)
    }

    const footPort = this.projWorld(footPort_wx, footPort_wy, 0, cx, cy)
    const footStar = this.projWorld(footStar_wx, footStar_wy, 0, cx, cy)
    const clew = this.projWorld(clew_wx, clew_wy, 0, cx, cy)

    const sailSh = 2 * this.visScale
    g.fillStyle(0x000000, 0.12)
    for (const [fx, fy, tx, ty] of [
      [footPort.x, footPort.y, mastTop.x, mastTop.y],
      [footStar.x, footStar.y, mastTop.x, mastTop.y],
    ] as const) {
      g.beginPath()
      g.moveTo(fx + sailSh, fy + sailSh)
      g.lineTo(tx + sailSh, ty + sailSh)
      g.lineTo(clew.x + sailSh, clew.y + sailSh)
      g.closePath()
      g.fillPath()
    }

    const smallPanel = pullStarboard
      ? [footPort.x, footPort.y, mastTop.x, mastTop.y, clew.x, clew.y] as const
      : [footStar.x, footStar.y, mastTop.x, mastTop.y, clew.x, clew.y] as const
    const bigPanel = pullStarboard
      ? [footStar.x, footStar.y, mastTop.x, mastTop.y, clew.x, clew.y] as const
      : [footPort.x, footPort.y, mastTop.x, mastTop.y, clew.x, clew.y] as const

    drawSailTri(
      smallPanel[0],
      smallPanel[1],
      smallPanel[2],
      smallPanel[3],
      smallPanel[4],
      smallPanel[5],
      sailColor,
      sailAlpha * 0.82
    )
    drawStripes(
      smallPanel[0],
      smallPanel[1],
      smallPanel[2],
      smallPanel[3],
      smallPanel[4],
      smallPanel[5],
      sailColor,
      sailAlpha * 0.82
    )

    drawSailTri(
      bigPanel[0],
      bigPanel[1],
      bigPanel[2],
      bigPanel[3],
      bigPanel[4],
      bigPanel[5],
      sailColor,
      sailAlpha
    )
    drawStripes(
      bigPanel[0],
      bigPanel[1],
      bigPanel[2],
      bigPanel[3],
      bigPanel[4],
      bigPanel[5],
      sailColor,
      sailAlpha
    )

    const dSmall = clewDist * 0.44
    const oppClew_wx = mast_wx + Math.cos(this.sailAngle + Math.PI) * dSmall
    const oppClew_wy = mast_wy + Math.sin(this.sailAngle + Math.PI) * dSmall
    const oppSign = pullStarboard ? -1 : 1
    const footOppA_wx = mast_wx + beamUx * oppSign * fullHalf * 0.62
    const footOppA_wy = mast_wy + beamUy * oppSign * fullHalf * 0.62
    const footOppB_wx = mast_wx + beamUx * oppSign * fullHalf * 0.2
    const footOppB_wy = mast_wy + beamUy * oppSign * fullHalf * 0.2

    const footOppA = this.projWorld(footOppA_wx, footOppA_wy, 0, cx, cy)
    const footOppB = this.projWorld(footOppB_wx, footOppB_wy, 0, cx, cy)
    const oppClew = this.projWorld(oppClew_wx, oppClew_wy, 0, cx, cy)

    // Smaller opposite sail: shares mast head; foot along boom side (narrow)
    g.fillStyle(0x000000, 0.1)
    g.beginPath()
    g.moveTo(footOppA.x + sailSh, footOppA.y + sailSh)
    g.lineTo(mastTop.x + sailSh, mastTop.y + sailSh)
    g.lineTo(oppClew.x + sailSh, oppClew.y + sailSh)
    g.closePath()
    g.fillPath()

    drawSailTri(
      footOppA.x,
      footOppA.y,
      mastTop.x,
      mastTop.y,
      oppClew.x,
      oppClew.y,
      sailColor,
      sailAlpha * 0.72
    )
    drawStripes(
      footOppA.x,
      footOppA.y,
      mastTop.x,
      mastTop.y,
      oppClew.x,
      oppClew.y,
      sailColor,
      sailAlpha * 0.72
    )

    g.lineStyle(1.2 * this.visScale, 0x4a3010, 0.65)
    g.beginPath()
    g.moveTo(footOppA.x, footOppA.y)
    g.lineTo(footOppB.x, footOppB.y)
    g.strokePath()

    g.lineStyle(2 * this.visScale, 0x4a3010, 0.85)
    g.beginPath()
    g.moveTo(footPort.x, footPort.y)
    g.lineTo(footStar.x, footStar.y)
    g.strokePath()

    g.lineStyle(2.5 * this.visScale, MAST_BODY, 1)
    g.beginPath()
    g.moveTo(mastBase.x, mastBase.y)
    g.lineTo(mastTop.x, mastTop.y)
    g.strokePath()
    g.lineStyle(1.5 * this.visScale, HULL_OUTLINE, 0.9)
    g.beginPath()
    g.moveTo(mastBase.x, mastBase.y)
    g.lineTo(mastTop.x, mastTop.y)
    g.strokePath()

    const mr = 4 * this.visScale
    g.fillStyle(MAST_BODY, 1)
    g.fillCircle(mastBase.x, mastBase.y, mr)
    g.lineStyle(1.5 * this.visScale, HULL_OUTLINE, 1)
    g.strokeCircle(mastBase.x, mastBase.y, mr)
    g.fillStyle(MAST_CAP, 1)
    g.fillCircle(mastTop.x, mastTop.y, mr * 0.55)

    if (this.speed > 0.5) {
      const dotCount = Math.min(5, Math.floor(this.speed))
      for (let i = 0; i < dotCount; i++) {
        const bowOff = this.rotatePoint(
          hullLength / 2 + 8 * this.visScale + i * 5 * this.visScale,
          0,
          this.heading
        )
        const p = this.projWorld(bowOff.x, bowOff.y, 0, cx, cy)
        g.fillStyle(0xffffff, 0.5 - i * 0.08)
        g.fillCircle(p.x, p.y, 2 * this.visScale)
      }
    }
  }

  private buildHull(length: number, width: number): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = []
    const steps = 20
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const angle = Math.PI * t
      const bowSharpness = 0.5
      const xFactor = Math.cos(angle)
      const x = xFactor * length / 2
      const widthFactor = Math.sin(angle) * (1 - Math.abs(xFactor) * bowSharpness)
      const y = -widthFactor * width
      pts.push({ x, y })
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps
      const angle = Math.PI * t
      const xFactor = Math.cos(angle)
      const x = xFactor * length / 2
      const widthFactor = Math.sin(angle) * (1 - Math.abs(xFactor) * 0.5)
      const y = widthFactor * width
      pts.push({ x, y })
    }
    return pts
  }

  private rotatePoint(x: number, y: number, angle: number): { x: number; y: number } {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return {
      x: x * cos - y * sin,
      y: x * sin + y * cos,
    }
  }

  destroy(): void {
    this.graphics.destroy()
    this.trailGraphics.destroy()
  }
}

/** Matches hull half-length / half-beam in `draw` after `projWorld` (world ≈ px / mapZoom). */
export function hullEllipseSemiAxesWorld(mapZoom: number): { halfLen: number; halfBeam: number } {
  const visScale = BOAT_VIS_SCALE * Math.pow(mapZoom / MAP_ZOOM_BASE, 0.3)
  const z = mapZoom
  return {
    halfLen: ((HULL_HALF_LENGTH_UNITS * visScale * visScale) / z) * 0.9,
    halfBeam: (((12 * 0.5) * visScale * visScale) / z) * 0.88,
  }
}

/**
 * Distance from boat center to expanded-hull ellipse along the ray to `(along, across)` in boat frame
 * (along = forward, across = starboard). Uses Minkowski +r with debris circle.
 */
export function boatDebrisBoundaryAlongRay(
  along: number,
  across: number,
  debrisR: number,
  mapZoom: number
): number {
  const { halfLen, halfBeam } = hullEllipseSemiAxesWorld(mapZoom)
  const a = halfLen + debrisR
  const b = halfBeam + debrisR
  const d = Math.hypot(along, across)
  if (d < 1e-8) return Math.min(a, b)
  const cosP = along / d
  const sinP = across / d
  return 1 / Math.sqrt((cosP / a) ** 2 + (sinP / b) ** 2)
}

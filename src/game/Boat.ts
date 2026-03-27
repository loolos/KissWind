import Phaser from 'phaser'
import { SailQuality } from './Physics'

/** Hull, mast, sail, strokes, and wake scale in the gameplay view (1 = original size). */
const BOAT_VIS_SCALE = 3

/** Top-down hull (dark blue body + cream deck like reference art). */
const HULL_BODY = 0x1e4477
const HULL_OUTLINE = 0x0d2644
const DECK_FILL = 0xecd9b8
const DECK_LINE = 0x88c4ee
const STRIPE_PINK = 0xe88a9a
const MAST_BODY = 0x2a4a7a
const MAST_CAP = 0x4a7acc

export class Boat {
  private scene: Phaser.Scene
  private graphics: Phaser.GameObjects.Graphics
  private trailGraphics: Phaser.GameObjects.Graphics

  sailAngle: number  // world-space angle of the sail
  heading: number    // boat heading (radians)
  sailQuality: SailQuality = 'yellow'
  speed: number = 0

  // For drawing wake/trail
  private trailPoints: { x: number; y: number }[] = []
  private trailTimer: number = 0

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.heading = 0
    this.sailAngle = Math.PI / 4

    this.trailGraphics = scene.add.graphics()
    this.trailGraphics.setDepth(1)

    this.graphics = scene.add.graphics()
    this.graphics.setDepth(10)
  }

  setSailAngle(angle: number): void {
    this.sailAngle = angle
  }

  update(dt: number, heading: number, speed: number, quality: SailQuality): void {
    this.heading = heading
    this.speed = speed
    this.sailQuality = quality

    // Track trail
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

    this.draw()
  }

  private draw(): void {
    const cx = this.scene.scale.width / 2
    const cy = this.scene.scale.height / 2

    this.trailGraphics.clear()
    if (this.speed > 0.3) {
      const wakeAngle = this.heading + Math.PI
      for (let side = -1; side <= 1; side += 2) {
        this.trailGraphics.lineStyle(1.5 * BOAT_VIS_SCALE, 0xaaddff, 0.3)
        this.trailGraphics.beginPath()
        let first = true
        for (let i = 0; i < 20; i++) {
          const t = i / 20
          const dist = i * 6 * BOAT_VIS_SCALE
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
    }

    this.graphics.clear()
    const g = this.graphics

    const hullLength = 44 * BOAT_VIS_SCALE
    const hullWidth = 16 * BOAT_VIS_SCALE
    const hullPoints = this.buildHull(hullLength, hullWidth)
    const rotatedHull = hullPoints.map(p => this.rotatePoint(p.x, p.y, this.heading))
    const innerHull = hullPoints.map(p =>
      this.rotatePoint(p.x * 0.72, p.y * 0.72, this.heading)
    )

    const sh = 3 * BOAT_VIS_SCALE
    g.fillStyle(0x000000, 0.22)
    g.beginPath()
    g.moveTo(cx + rotatedHull[0].x + sh, cy + rotatedHull[0].y + sh)
    for (let i = 1; i < rotatedHull.length; i++) {
      g.lineTo(cx + rotatedHull[i].x + sh, cy + rotatedHull[i].y + sh)
    }
    g.closePath()
    g.fillPath()

    g.fillStyle(HULL_BODY, 1)
    g.beginPath()
    g.moveTo(cx + rotatedHull[0].x, cy + rotatedHull[0].y)
    for (let i = 1; i < rotatedHull.length; i++) {
      g.lineTo(cx + rotatedHull[i].x, cy + rotatedHull[i].y)
    }
    g.closePath()
    g.fillPath()

    g.fillStyle(DECK_FILL, 1)
    g.beginPath()
    g.moveTo(cx + innerHull[0].x, cy + innerHull[0].y)
    for (let i = 1; i < innerHull.length; i++) {
      g.lineTo(cx + innerHull[i].x, cy + innerHull[i].y)
    }
    g.closePath()
    g.fillPath()

    // Deck detail lines (top-down)
    const bow = this.rotatePoint(hullLength * 0.35, 0, this.heading)
    const stern = this.rotatePoint(-hullLength * 0.35, 0, this.heading)
    g.lineStyle(1.2 * BOAT_VIS_SCALE, DECK_LINE, 0.55)
    g.beginPath()
    g.moveTo(cx + bow.x * 0.55, cy + bow.y * 0.55)
    g.lineTo(cx + stern.x * 0.55, cy + stern.y * 0.55)
    g.strokePath()
    g.beginPath()
    g.moveTo(cx + bow.x * 0.35, cy + bow.y * 0.35)
    g.lineTo(cx + stern.x * 0.35, cy + stern.y * 0.35)
    g.strokePath()

    g.lineStyle(2 * BOAT_VIS_SCALE, HULL_OUTLINE, 1)
    g.beginPath()
    g.moveTo(cx + rotatedHull[0].x, cy + rotatedHull[0].y)
    for (let i = 1; i < rotatedHull.length; i++) {
      g.lineTo(cx + rotatedHull[i].x, cy + rotatedHull[i].y)
    }
    g.closePath()
    g.strokePath()

    // Mast position on deck (plan view)
    const mastX = 5 * BOAT_VIS_SCALE
    const mastBase = this.rotatePoint(mastX, 0, this.heading)
    const mastPt = { x: cx + mastBase.x, y: cy + mastBase.y }

    let sailColor: number
    let sailAlpha: number
    switch (this.sailQuality) {
      case 'green':
        sailColor = 0x44dd88
        sailAlpha = 0.92
        break
      case 'yellow':
        sailColor = 0xffdd44
        sailAlpha = 0.92
        break
      case 'red':
        sailColor = 0xff4444
        sailAlpha = 0.85
        break
    }

    const beamUx = Math.cos(this.heading + Math.PI / 2)
    const beamUy = Math.sin(this.heading + Math.PI / 2)
    const clewDist = 56 * BOAT_VIS_SCALE
    const clew = {
      x: mastPt.x + Math.cos(this.sailAngle) * clewDist,
      y: mastPt.y + Math.sin(this.sailAngle) * clewDist,
    }

    const toClewX = clew.x - mastPt.x
    const toClewY = clew.y - mastPt.y
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
    const footPort = {
      x: mastPt.x - beamUx * portDist,
      y: mastPt.y - beamUy * portDist,
    }
    const footStar = {
      x: mastPt.x + beamUx * starDist,
      y: mastPt.y + beamUy * starDist,
    }

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
      g.lineStyle(1.5 * BOAT_VIS_SCALE, 0x000000, 0.45)
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
      alpha: number
    ): void => {
      g.lineStyle(1.1 * BOAT_VIS_SCALE, STRIPE_PINK, 0.55 * alpha)
      for (let s = 1; s <= 5; s++) {
        const t = 0.12 + s * 0.13
        const q1x = ax + t * (cx2 - ax)
        const q1y = ay + t * (cy2 - ay)
        const q2x = bx + t * (cx2 - bx)
        const q2y = by + t * (cy2 - by)
        g.beginPath()
        g.moveTo(q1x, q1y)
        g.lineTo(q2x, q2y)
        g.strokePath()
      }
    }

    const sailSh = 2 * BOAT_VIS_SCALE
    g.fillStyle(0x000000, 0.12)
    for (const [fx, fy, tx, ty] of [
      [footPort.x, footPort.y, mastPt.x, mastPt.y],
      [footStar.x, footStar.y, mastPt.x, mastPt.y],
    ] as const) {
      g.beginPath()
      g.moveTo(fx + sailSh, fy + sailSh)
      g.lineTo(tx + sailSh, ty + sailSh)
      g.lineTo(clew.x + sailSh, clew.y + sailSh)
      g.closePath()
      g.fillPath()
    }

    const smallPanel = pullStarboard
      ? [footPort.x, footPort.y, mastPt.x, mastPt.y, clew.x, clew.y] as const
      : [footStar.x, footStar.y, mastPt.x, mastPt.y, clew.x, clew.y] as const
    const bigPanel = pullStarboard
      ? [footStar.x, footStar.y, mastPt.x, mastPt.y, clew.x, clew.y] as const
      : [footPort.x, footPort.y, mastPt.x, mastPt.y, clew.x, clew.y] as const

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
      sailAlpha
    )

    // Third sail: smaller, on the side opposite the main clew (plan view)
    const dSmall = clewDist * 0.44
    const oppClew = {
      x: mastPt.x + Math.cos(this.sailAngle + Math.PI) * dSmall,
      y: mastPt.y + Math.sin(this.sailAngle + Math.PI) * dSmall,
    }
    const oppSign = pullStarboard ? -1 : 1
    const footOppA = {
      x: mastPt.x + beamUx * oppSign * fullHalf * 0.62,
      y: mastPt.y + beamUy * oppSign * fullHalf * 0.62,
    }
    const footOppB = {
      x: mastPt.x + beamUx * oppSign * fullHalf * 0.2,
      y: mastPt.y + beamUy * oppSign * fullHalf * 0.2,
    }

    g.fillStyle(0x000000, 0.1)
    g.beginPath()
    g.moveTo(footOppA.x + sailSh, footOppA.y + sailSh)
    g.lineTo(footOppB.x + sailSh, footOppB.y + sailSh)
    g.lineTo(oppClew.x + sailSh, oppClew.y + sailSh)
    g.closePath()
    g.fillPath()

    drawSailTri(
      footOppA.x,
      footOppA.y,
      footOppB.x,
      footOppB.y,
      oppClew.x,
      oppClew.y,
      sailColor,
      sailAlpha * 0.72
    )
    drawStripes(footOppA.x, footOppA.y, footOppB.x, footOppB.y, oppClew.x, oppClew.y, sailAlpha * 0.72)

    g.lineStyle(2 * BOAT_VIS_SCALE, 0x4a3010, 0.85)
    g.beginPath()
    g.moveTo(footPort.x, footPort.y)
    g.lineTo(footStar.x, footStar.y)
    g.strokePath()

    // Mast as deck fixture (top-down)
    const mr = 4 * BOAT_VIS_SCALE
    g.fillStyle(MAST_BODY, 1)
    g.fillCircle(mastPt.x, mastPt.y, mr)
    g.lineStyle(1.5 * BOAT_VIS_SCALE, HULL_OUTLINE, 1)
    g.strokeCircle(mastPt.x, mastPt.y, mr)
    g.fillStyle(MAST_CAP, 1)
    g.fillCircle(mastPt.x, mastPt.y, mr * 0.45)

    if (this.speed > 0.5) {
      const dotCount = Math.min(5, Math.floor(this.speed))
      for (let i = 0; i < dotCount; i++) {
        const bowTip = this.rotatePoint(
          hullLength / 2 + 8 * BOAT_VIS_SCALE + i * 5 * BOAT_VIS_SCALE,
          0,
          this.heading
        )
        g.fillStyle(0xffffff, 0.5 - i * 0.08)
        g.fillCircle(cx + bowTip.x, cy + bowTip.y, 2 * BOAT_VIS_SCALE)
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

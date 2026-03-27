import Phaser from 'phaser'
import { SailQuality } from './Physics'

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
      // Trail is always at screen center (boat is fixed in screen space)
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

    // Draw wake trail
    this.trailGraphics.clear()
    if (this.speed > 0.3) {
      const wakeAngle = this.heading + Math.PI  // behind the boat
      for (let side = -1; side <= 1; side += 2) {
        this.trailGraphics.lineStyle(1.5, 0xaaddff, 0.3)
        this.trailGraphics.beginPath()
        let first = true
        for (let i = 0; i < 20; i++) {
          const t = i / 20
          const dist = i * 6
          const spreadAngle = wakeAngle + side * t * 0.35
          const wx = cx + Math.cos(spreadAngle) * dist
          const wy = cy + Math.sin(spreadAngle) * dist
          if (first) { this.trailGraphics.moveTo(wx, wy); first = false }
          else this.trailGraphics.lineTo(wx, wy)
        }
        this.trailGraphics.strokePath()
      }
    }

    this.graphics.clear()

    // Save and rotate context around boat center
    const g = this.graphics

    // Hull color
    const hullColor = 0xd4a853
    const hullDark = 0x8b6914
    const hullHighlight = 0xe8c070

    // Draw hull (pointed oval rotated to heading)
    const hullLength = 44
    const hullWidth = 16
    const hullPoints = this.buildHull(hullLength, hullWidth)
    const rotatedHull = hullPoints.map(p => this.rotatePoint(p.x, p.y, this.heading))

    // Hull shadow
    g.fillStyle(0x000000, 0.25)
    g.beginPath()
    g.moveTo(cx + rotatedHull[0].x + 3, cy + rotatedHull[0].y + 3)
    for (let i = 1; i < rotatedHull.length; i++) {
      g.lineTo(cx + rotatedHull[i].x + 3, cy + rotatedHull[i].y + 3)
    }
    g.closePath()
    g.fillPath()

    // Hull fill
    g.fillStyle(hullColor, 1)
    g.beginPath()
    g.moveTo(cx + rotatedHull[0].x, cy + rotatedHull[0].y)
    for (let i = 1; i < rotatedHull.length; i++) {
      g.lineTo(cx + rotatedHull[i].x, cy + rotatedHull[i].y)
    }
    g.closePath()
    g.fillPath()

    // Hull outline
    g.lineStyle(2, hullDark, 1)
    g.beginPath()
    g.moveTo(cx + rotatedHull[0].x, cy + rotatedHull[0].y)
    for (let i = 1; i < rotatedHull.length; i++) {
      g.lineTo(cx + rotatedHull[i].x, cy + rotatedHull[i].y)
    }
    g.closePath()
    g.strokePath()

    // Hull highlight (top stripe)
    g.lineStyle(3, hullHighlight, 0.7)
    g.beginPath()
    const hl1 = this.rotatePoint(-hullLength * 0.3, -hullWidth * 0.3, this.heading)
    const hl2 = this.rotatePoint(hullLength * 0.4, -hullWidth * 0.3, this.heading)
    g.moveTo(cx + hl1.x, cy + hl1.y)
    g.lineTo(cx + hl2.x, cy + hl2.y)
    g.strokePath()

    // Mast (from deck; taller for a larger sail)
    const mastX = 5
    const mastBase = this.rotatePoint(mastX, 0, this.heading)
    const mastHeight = 58
    const mastTop = this.rotatePoint(mastX, -mastHeight, this.heading)
    g.lineStyle(2.5, 0x5c3d11, 1)
    g.beginPath()
    g.moveTo(cx + mastBase.x, cy + mastBase.y)
    g.lineTo(cx + mastTop.x, cy + mastTop.y)
    g.strokePath()

    // Sail color based on quality
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

    // Boom spans beam of hull; clew (sail corner) follows world-space sailAngle from mast top
    const beamUx = Math.cos(this.heading + Math.PI / 2)
    const beamUy = Math.sin(this.heading + Math.PI / 2)
    const clewDist = 56
    const mt = { x: cx + mastTop.x, y: cy + mastTop.y }
    const clew = {
      x: mt.x + Math.cos(this.sailAngle) * clewDist,
      y: mt.y + Math.sin(this.sailAngle) * clewDist,
    }

    // Side toward clew = "pulled" side (larger panel); other side shorter along boom
    const toClewX = clew.x - mt.x
    const toClewY = clew.y - mt.y
    const pullStarboard = toClewX * beamUx + toClewY * beamUy > 0
    const mb = { x: cx + mastBase.x, y: cy + mastBase.y }
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
      x: mb.x - beamUx * portDist,
      y: mb.y - beamUy * portDist,
    }
    const footStar = {
      x: mb.x + beamUx * starDist,
      y: mb.y + beamUy * starDist,
    }

    const drawSailTri = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      cx: number,
      cy: number,
      fill: number,
      alpha: number,
      ox: number,
      oy: number
    ): void => {
      g.fillStyle(fill, alpha)
      g.beginPath()
      g.moveTo(ax + ox, ay + oy)
      g.lineTo(bx + ox, by + oy)
      g.lineTo(cx + ox, cy + oy)
      g.closePath()
      g.fillPath()
      g.lineStyle(1.5, 0x000000, 0.4)
      g.beginPath()
      g.moveTo(ax, ay)
      g.lineTo(bx, by)
      g.lineTo(cx, cy)
      g.closePath()
      g.strokePath()
    }

    // Shadow (both panels)
    g.fillStyle(0x000000, 0.15)
    for (const [fx, fy, tx, ty] of [
      [footPort.x, footPort.y, mt.x, mt.y],
      [footStar.x, footStar.y, mt.x, mt.y],
    ] as const) {
      g.beginPath()
      g.moveTo(fx + 2, fy + 2)
      g.lineTo(tx + 2, ty + 2)
      g.lineTo(clew.x + 2, clew.y + 2)
      g.closePath()
      g.fillPath()
    }

    // Fill: smaller panel slightly dimmer so asymmetry reads clearly
    const smallPanel = pullStarboard
      ? [footPort.x, footPort.y, mt.x, mt.y, clew.x, clew.y] as const
      : [footStar.x, footStar.y, mt.x, mt.y, clew.x, clew.y] as const
    const bigPanel = pullStarboard
      ? [footStar.x, footStar.y, mt.x, mt.y, clew.x, clew.y] as const
      : [footPort.x, footPort.y, mt.x, mt.y, clew.x, clew.y] as const

    drawSailTri(smallPanel[0], smallPanel[1], smallPanel[2], smallPanel[3], smallPanel[4], smallPanel[5], sailColor, sailAlpha * 0.82, 0, 0)
    drawSailTri(bigPanel[0], bigPanel[1], bigPanel[2], bigPanel[3], bigPanel[4], bigPanel[5], sailColor, sailAlpha, 0, 0)

    // Boom line along foot
    g.lineStyle(2, 0x4a3010, 0.85)
    g.beginPath()
    g.moveTo(footPort.x, footPort.y)
    g.lineTo(footStar.x, footStar.y)
    g.strokePath()

    // Speed indicator dots at bow
    if (this.speed > 0.5) {
      const dotCount = Math.min(5, Math.floor(this.speed))
      for (let i = 0; i < dotCount; i++) {
        const bowTip = this.rotatePoint(hullLength / 2 + 8 + i * 5, 0, this.heading)
        g.fillStyle(0xffffff, 0.5 - i * 0.08)
        g.fillCircle(cx + bowTip.x, cy + bowTip.y, 2)
      }
    }
  }

  private buildHull(length: number, width: number): { x: number; y: number }[] {
    // Pointed oval: bow (+x), stern (-x)
    const pts: { x: number; y: number }[] = []
    const steps = 20
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const angle = Math.PI * t  // 0..PI for top half
      // Pointed at bow, rounded at stern
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

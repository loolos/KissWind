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

    // Mast (thin vertical line from hull center)
    const mastBase = this.rotatePoint(5, 0, this.heading)
    const mastTop = this.rotatePoint(5, -50, this.heading)
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

    // Sail: triangle from mast base to mast top to sail tip
    // sailAngle is world-space, we draw relative to mast position
    const sailLength = 40
    const sailTip = this.rotatePoint(5 + Math.cos(this.sailAngle) * sailLength, -25 + Math.sin(this.sailAngle) * sailLength, 0)
    // Mast base at heading-rotated position
    const mb = { x: cx + mastBase.x, y: cy + mastBase.y }
    const mt = { x: cx + mastTop.x, y: cy + mastTop.y }
    const st = { x: cx + sailTip.x, y: cy + sailTip.y }

    // Sail shadow
    g.fillStyle(0x000000, 0.15)
    g.beginPath()
    g.moveTo(mb.x + 2, mb.y + 2)
    g.lineTo(mt.x + 2, mt.y + 2)
    g.lineTo(st.x + 2, st.y + 2)
    g.closePath()
    g.fillPath()

    // Sail fill
    g.fillStyle(sailColor, sailAlpha)
    g.beginPath()
    g.moveTo(mb.x, mb.y)
    g.lineTo(mt.x, mt.y)
    g.lineTo(st.x, st.y)
    g.closePath()
    g.fillPath()

    // Sail outline
    g.lineStyle(1.5, 0x000000, 0.4)
    g.beginPath()
    g.moveTo(mb.x, mb.y)
    g.lineTo(mt.x, mt.y)
    g.lineTo(st.x, st.y)
    g.closePath()
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

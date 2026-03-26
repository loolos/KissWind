import Phaser from 'phaser'

interface WaveLine {
  x: number
  y: number
  len: number
  alpha: number
}

export class BootScene extends Phaser.Scene {
  private bg!: Phaser.GameObjects.Graphics
  private waveGraphics!: Phaser.GameObjects.Graphics
  private boatG!: Phaser.GameObjects.Graphics
  private arrowG!: Phaser.GameObjects.Graphics
  private title!: Phaser.GameObjects.Text
  private btnBg!: Phaser.GameObjects.Graphics
  private waveLines: WaveLine[] = []
  private windAngle: number = 0
  private elapsed: number = 0
  private btnX: number = 0
  private btnY: number = 0
  private btnW: number = 0
  private btnH: number = 0

  constructor() {
    super({ key: 'BootScene' })
  }

  create(): void {
    const w = this.scale.width
    const h = this.scale.height

    this.windAngle = Math.random() * Math.PI * 2
    this.elapsed = 0

    this.bg = this.add.graphics().setDepth(0)
    this.waveGraphics = this.add.graphics().setDepth(1)
    this.boatG = this.add.graphics().setDepth(2)
    this.arrowG = this.add.graphics().setDepth(3)
    this.btnBg = this.add.graphics().setDepth(4)

    this.waveLines = []
    for (let i = 0; i < 25; i++) {
      this.waveLines.push({
        x: Math.random() * w,
        y: Math.random() * h,
        len: 30 + Math.random() * 80,
        alpha: 0.1 + Math.random() * 0.2,
      })
    }

    this.drawBackground(w, h)

    this.boatG.clear()
    this.drawTitleBoat(this.boatG, w * 0.5, h * 0.52)

    const fontSize = Math.min(w * 0.12, 72)
    this.title = this.add.text(w / 2, h * 0.18, 'KissWind', {
      fontSize: fontSize + 'px',
      fontFamily: 'Georgia, serif',
      color: '#e8f4ff',
      stroke: '#1a4080',
      strokeThickness: 6,
      shadow: { offsetX: 3, offsetY: 3, color: '#000033', blur: 8, fill: true },
    }).setOrigin(0.5).setDepth(5)

    const subSize = Math.min(w * 0.04, 22)
    this.add.text(w / 2, h * 0.30, 'A Sailing Adventure', {
      fontSize: subSize + 'px',
      fontFamily: 'Georgia, serif',
      color: '#aaddff',
      stroke: '#0a2040',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(5)

    const instrSize = Math.min(w * 0.03, 16)
    this.add.text(
      w / 2, h * 0.78,
      'Drag to rotate the sail\nFind the sweet spot for maximum speed\n60 seconds to sail as far as possible',
      {
        fontSize: instrSize + 'px',
        fontFamily: 'Arial, sans-serif',
        color: '#88ccee',
        align: 'center',
      }
    ).setOrigin(0.5).setDepth(5)

    this.btnW = Math.min(w * 0.45, 220)
    this.btnH = 55
    this.btnX = w / 2 - this.btnW / 2
    this.btnY = h * 0.87 - this.btnH / 2

    this.drawButton(false)

    this.add.text(w / 2, h * 0.87, 'SET SAIL!', {
      fontSize: Math.min(w * 0.05, 26) + 'px',
      fontFamily: 'Georgia, serif',
      color: '#ffffff',
      stroke: '#003366',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(6)

    const btnZone = this.add
      .zone(w / 2, h * 0.87, this.btnW + 20, this.btnH + 20)
      .setInteractive()
      .setDepth(7)

    btnZone.on('pointerover', () => this.drawButton(true))
    btnZone.on('pointerout', () => this.drawButton(false))
    btnZone.on('pointerdown', () => {
      this.drawButton(true)
      this.time.delayedCall(150, () => this.scene.start('GameScene'))
    })
  }

  update(_time: number, delta: number): void {
    const w = this.scale.width
    const h = this.scale.height
    const dt = delta / 1000

    this.elapsed += dt
    this.windAngle += 0.005

    this.waveGraphics.clear()
    for (const wl of this.waveLines) {
      wl.x -= Math.cos(this.windAngle) * 0.8 + 0.3
      wl.y -= Math.sin(this.windAngle) * 0.8

      if (wl.x < -100) wl.x += w + 200
      if (wl.x > w + 100) wl.x -= w + 200
      if (wl.y < -100) wl.y += h + 200
      if (wl.y > h + 100) wl.y -= h + 200

      const perpX = Math.cos(this.windAngle + Math.PI / 2)
      const perpY = Math.sin(this.windAngle + Math.PI / 2)
      this.waveGraphics.lineStyle(1.5, 0x88bbdd, wl.alpha)
      this.waveGraphics.beginPath()
      this.waveGraphics.moveTo(wl.x - perpX * wl.len / 2, wl.y - perpY * wl.len / 2)
      this.waveGraphics.lineTo(wl.x + perpX * wl.len / 2, wl.y + perpY * wl.len / 2)
      this.waveGraphics.strokePath()
    }

    this.title.setAlpha(0.85 + Math.sin(this.elapsed * 1.5) * 0.15)

    this.arrowG.clear()
    this.drawWindArrow(this.arrowG, w * 0.5, h * 0.39, this.windAngle, 28)
  }

  private drawBackground(w: number, h: number): void {
    this.bg.clear()
    const gradColors = [
      { r: 8, g: 24, b: 64 },
      { r: 10, g: 30, b: 74 },
      { r: 11, g: 38, b: 84 },
      { r: 13, g: 48, b: 96 },
      { r: 15, g: 58, b: 108 },
      { r: 17, g: 68, b: 120 },
      { r: 18, g: 76, b: 130 },
      { r: 20, g: 80, b: 140 },
    ]
    const bands = gradColors.length
    for (let i = 0; i < bands; i++) {
      const c = gradColors[i]
      this.bg.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1)
      this.bg.fillRect(0, i * (h / bands), w, h / bands + 1)
    }
  }

  private drawButton(hovered: boolean): void {
    this.btnBg.clear()
    const mainColor = hovered ? 0x2266bb : 0x1a4a8a
    const borderColor = hovered ? 0x66aaff : 0x4488cc
    const glowColor = hovered ? 0x4488ff : 0x336699

    this.btnBg.fillStyle(glowColor, 0.3)
    this.btnBg.fillRoundedRect(this.btnX - 4, this.btnY - 4, this.btnW + 8, this.btnH + 8, 14)
    this.btnBg.fillStyle(mainColor, 1)
    this.btnBg.fillRoundedRect(this.btnX, this.btnY, this.btnW, this.btnH, 10)
    this.btnBg.fillStyle(0xffffff, 0.15)
    this.btnBg.fillRoundedRect(this.btnX + 2, this.btnY + 2, this.btnW - 4, this.btnH / 2 - 2, 8)
    this.btnBg.lineStyle(2, borderColor, 1)
    this.btnBg.strokeRoundedRect(this.btnX, this.btnY, this.btnW, this.btnH, 10)
  }

  private drawTitleBoat(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
    const scale = 1.8
    const hullPts = this.makeHull(44 * scale, 16 * scale)

    g.fillStyle(0xd4a853, 1)
    g.beginPath()
    g.moveTo(cx + hullPts[0].x, cy + hullPts[0].y)
    hullPts.slice(1).forEach(p => g.lineTo(cx + p.x, cy + p.y))
    g.closePath()
    g.fillPath()

    g.lineStyle(2, 0x8b6914, 1)
    g.beginPath()
    g.moveTo(cx + hullPts[0].x, cy + hullPts[0].y)
    hullPts.slice(1).forEach(p => g.lineTo(cx + p.x, cy + p.y))
    g.closePath()
    g.strokePath()

    g.lineStyle(3, 0x5c3d11, 1)
    g.beginPath()
    g.moveTo(cx + 9, cy)
    g.lineTo(cx + 9, cy - 90)
    g.strokePath()

    const sailAng = -0.4
    const tipX = cx + 9 + Math.cos(sailAng) * 70
    const tipY = cy - 45 + Math.sin(sailAng) * 70
    g.fillStyle(0xddeeff, 0.9)
    g.beginPath()
    g.moveTo(cx + 9, cy)
    g.lineTo(cx + 9, cy - 90)
    g.lineTo(tipX, tipY)
    g.closePath()
    g.fillPath()
    g.lineStyle(1.5, 0x000000, 0.3)
    g.beginPath()
    g.moveTo(cx + 9, cy)
    g.lineTo(cx + 9, cy - 90)
    g.lineTo(tipX, tipY)
    g.closePath()
    g.strokePath()
  }

  private makeHull(length: number, width: number): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = []
    const steps = 20
    for (let i = 0; i <= steps; i++) {
      const angle = Math.PI * (i / steps)
      const xf = Math.cos(angle)
      const x = xf * length / 2
      const y = -Math.sin(angle) * (1 - Math.abs(xf) * 0.5) * width
      pts.push({ x, y })
    }
    for (let i = steps; i >= 0; i--) {
      const angle = Math.PI * (i / steps)
      const xf = Math.cos(angle)
      const x = xf * length / 2
      const y = Math.sin(angle) * (1 - Math.abs(xf) * 0.5) * width
      pts.push({ x, y })
    }
    return pts
  }

  private drawWindArrow(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    angle: number, size: number
  ): void {
    const ex = cx + Math.cos(angle) * size
    const ey = cy + Math.sin(angle) * size
    const sx = cx - Math.cos(angle) * size
    const sy = cy - Math.sin(angle) * size

    g.lineStyle(2.5, 0x88ccff, 0.7)
    g.beginPath()
    g.moveTo(sx, sy)
    g.lineTo(ex, ey)
    g.strokePath()

    const hs = size * 0.4
    const left = angle + Math.PI * 0.75
    const right = angle - Math.PI * 0.75
    g.fillStyle(0x88ccff, 0.7)
    g.beginPath()
    g.moveTo(ex, ey)
    g.lineTo(ex + Math.cos(left) * hs, ey + Math.sin(left) * hs)
    g.lineTo(ex + Math.cos(right) * hs, ey + Math.sin(right) * hs)
    g.closePath()
    g.fillPath()
  }
}

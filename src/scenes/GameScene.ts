import Phaser from 'phaser'
import { Boat } from '../game/Boat'
import { Wind } from '../game/Wind'
import { World } from '../game/World'
import {
  PhysicsState,
  ThrustResult,
  computeThrust,
  updatePhysics,
  normalizeAngle,
} from '../game/Physics'

const GAME_DURATION = 60  // seconds

export class GameScene extends Phaser.Scene {
  // Core systems
  private boat!: Boat
  private wind!: Wind
  private world!: World

  // Physics state
  private physState!: PhysicsState
  private lastThrust!: ThrustResult

  // Sail control
  private isDragging: boolean = false
  private dragStartX: number = 0
  private dragStartY: number = 0
  private sailAngleAtDragStart: number = 0

  // HUD
  private hudGraphics!: Phaser.GameObjects.Graphics
  private timerText!: Phaser.GameObjects.Text
  private scoreText!: Phaser.GameObjects.Text
  private speedText!: Phaser.GameObjects.Text
  private qualityText!: Phaser.GameObjects.Text

  // Game state
  private timeLeft: number = GAME_DURATION
  private totalDistance: number = 0
  private gameOver: boolean = false
  private gameOverContainer!: Phaser.GameObjects.Container

  // Scoring: accumulated distance in game-units (convert to "meters" for display)
  private METERS_PER_UNIT = 2

  constructor() {
    super({ key: 'GameScene' })
  }

  create(): void {
    const w = this.scale.width
    const h = this.scale.height

    // Reset game state (scene.restart() reuses the instance, so class fields keep old values)
    this.gameOver = false
    this.timeLeft = GAME_DURATION
    this.totalDistance = 0
    this.isDragging = false

    // Initialize systems
    this.wind = new Wind()
    this.world = new World(this)
    this.boat = new Boat(this)

    this.physState = {
      speed: 0,
      heading: this.wind.direction,  // start facing into wind
      posX: 0,
      posY: 0,
    }

    this.lastThrust = { thrust: 0, quality: 'yellow', multiplier: 1.0 }

    // Initial sail angle: slightly off the wind for a good start
    this.boat.sailAngle = this.wind.direction + Math.PI * 0.6

    // HUD layer
    this.hudGraphics = this.add.graphics()
    this.hudGraphics.setDepth(20)

    this.createHUD()
    this.setupInput()

    // Handle resize
    this.scale.on('resize', this.onResize, this)
  }

  private createHUD(): void {
    const w = this.scale.width
    const h = this.scale.height
    const fontSize = Math.max(14, Math.min(24, w * 0.04))

    // Timer (top-left)
    this.timerText = this.add.text(16, 16, 'TIME: 60', {
      fontSize: fontSize + 'px',
      fontFamily: 'Georgia, serif',
      color: '#ffffff',
      stroke: '#000033',
      strokeThickness: 4,
    })
    this.timerText.setDepth(25)

    // Score (top-right)
    this.scoreText = this.add.text(w - 16, 16, 'DIST: 0m', {
      fontSize: fontSize + 'px',
      fontFamily: 'Georgia, serif',
      color: '#ffffff',
      stroke: '#000033',
      strokeThickness: 4,
    })
    this.scoreText.setOrigin(1, 0)
    this.scoreText.setDepth(25)

    // Speed indicator (below timer)
    this.speedText = this.add.text(16, 16 + fontSize + 8, 'SPD: 0.0', {
      fontSize: Math.floor(fontSize * 0.8) + 'px',
      fontFamily: 'Arial, sans-serif',
      color: '#aaddff',
      stroke: '#000033',
      strokeThickness: 3,
    })
    this.speedText.setDepth(25)

    // Sail quality indicator text (below speed)
    this.qualityText = this.add.text(16, 16 + fontSize + 8 + Math.floor(fontSize * 0.8) + 6, '● OPTIMAL', {
      fontSize: Math.floor(fontSize * 0.8) + 'px',
      fontFamily: 'Arial, sans-serif',
      color: '#44ff88',
      stroke: '#000033',
      strokeThickness: 3,
    })
    this.qualityText.setDepth(25)
  }

  private setupInput(): void {
    const canvas = this.sys.canvas

    // Mouse
    this.input.on('pointerdown', this.onPointerDown, this)
    this.input.on('pointermove', this.onPointerMove, this)
    this.input.on('pointerup', this.onPointerUp, this)
    this.input.on('pointerupoutside', this.onPointerUp, this)
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.gameOver) return
    this.isDragging = true
    this.dragStartX = pointer.x
    this.dragStartY = pointer.y
    this.sailAngleAtDragStart = this.boat.sailAngle
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.isDragging || this.gameOver) return

    const cx = this.scale.width / 2
    const cy = this.scale.height / 2

    // Angle from boat center to current pointer
    const currentAngle = Math.atan2(pointer.y - cy, pointer.x - cx)
    const startAngle = Math.atan2(this.dragStartY - cy, this.dragStartX - cx)

    // Delta angle
    const deltaAngle = normalizeAngle(currentAngle - startAngle)
    this.boat.sailAngle = this.sailAngleAtDragStart + deltaAngle
  }

  private onPointerUp(_pointer: Phaser.Input.Pointer): void {
    this.isDragging = false
  }

  update(time: number, delta: number): void {
    if (this.gameOver) return

    const dt = Math.min(delta / 1000, 0.05)  // cap at 50ms

    // Update timer
    this.timeLeft -= dt
    if (this.timeLeft <= 0) {
      this.timeLeft = 0
      this.showGameOver()
      return
    }

    // Update wind
    this.wind.update(dt, this.physState.posX, this.physState.posY)

    // Get effective wind strength at boat position
    const effectiveStrength = this.wind.getStrengthAt(this.physState.posX, this.physState.posY)

    // Compute thrust
    this.lastThrust = computeThrust(
      this.boat.sailAngle,
      this.wind.direction,
      this.physState.heading,
      effectiveStrength
    )

    // Update physics
    const prevPos = { x: this.physState.posX, y: this.physState.posY }
    this.physState = updatePhysics(
      this.physState,
      this.lastThrust.thrust,
      this.wind.direction,
      dt
    )

    // Accumulate distance
    const dx = this.physState.posX - prevPos.x
    const dy = this.physState.posY - prevPos.y
    this.totalDistance += Math.sqrt(dx * dx + dy * dy)

    // Compute velocity vector for world scrolling
    const vx = Math.cos(this.physState.heading) * this.physState.speed
    const vy = Math.sin(this.physState.heading) * this.physState.speed

    // Update boat visual
    this.boat.update(dt, this.physState.heading, this.physState.speed, this.lastThrust.quality)

    // Update world (pass velocity for scrolling)
    this.world.update(dt, vx, vy, this.wind.direction, effectiveStrength, this.wind.zones)

    // Update HUD
    this.updateHUD()
  }

  private updateHUD(): void {
    const w = this.scale.width
    const h = this.scale.height

    // Timer text with color warning
    const t = this.timeLeft
    const timerColor = t > 20 ? '#ffffff' : t > 10 ? '#ffdd44' : '#ff4444'
    this.timerText.setColor(timerColor)
    this.timerText.setText(`TIME: ${Math.ceil(t)}`)

    // Score
    const meters = Math.floor(this.totalDistance * this.METERS_PER_UNIT)
    this.scoreText.setText(`${meters}m`)

    // Speed
    this.speedText.setText(`SPD: ${this.physState.speed.toFixed(1)}`)

    // Quality
    const q = this.lastThrust.quality
    const qualityColors: Record<string, string> = {
      green: '#44ff88',
      yellow: '#ffdd44',
      red: '#ff6644',
    }
    const qualityLabels: Record<string, string> = {
      green: '● SWEET SPOT',
      yellow: '● GOOD',
      red: '● STALL',
    }
    this.qualityText.setColor(qualityColors[q])
    this.qualityText.setText(qualityLabels[q])

    // Draw HUD graphics
    this.hudGraphics.clear()

    // Background panels
    const panelAlpha = 0.45
    this.hudGraphics.fillStyle(0x000022, panelAlpha)
    this.hudGraphics.fillRoundedRect(8, 8, 200, 80, 8)

    this.hudGraphics.fillStyle(0x000022, panelAlpha)
    this.hudGraphics.fillRoundedRect(w - 120, 8, 112, 36, 8)

    // Wind direction compass (top-center)
    this.drawWindCompass(w / 2, 44, this.wind.direction, this.physState.heading)

    // Speed bar (bottom of left panel)
    const barX = 16
    const barY = 80
    const barW = 180
    const barH = 8
    const speedFrac = Math.min(1, this.physState.speed / 6)

    this.hudGraphics.fillStyle(0x002244, 0.8)
    this.hudGraphics.fillRoundedRect(barX, barY, barW, barH, 4)

    const barColor = speedFrac > 0.7 ? 0x44ff88 : speedFrac > 0.4 ? 0x44aaff : 0x4466ff
    this.hudGraphics.fillStyle(barColor, 0.9)
    this.hudGraphics.fillRoundedRect(barX, barY, barW * speedFrac, barH, 4)

    // Timer bar at bottom of screen
    const timerFrac = this.timeLeft / GAME_DURATION
    const timerBarH = 4
    const timerColor2 = timerFrac > 0.33 ? 0x44aaff : timerFrac > 0.16 ? 0xffdd44 : 0xff4444
    this.hudGraphics.fillStyle(0x001133, 0.7)
    this.hudGraphics.fillRect(0, h - timerBarH - 2, w, timerBarH + 2)
    this.hudGraphics.fillStyle(timerColor2, 0.9)
    this.hudGraphics.fillRect(0, h - timerBarH - 2, w * timerFrac, timerBarH + 2)

    // Sail angle hint arc (bottom-center)
    this.drawSailHint(w / 2, h - 55)
  }

  private drawWindCompass(cx: number, cy: number, windDir: number, heading: number): void {
    const g = this.hudGraphics
    const r = 30

    // Background circle
    g.fillStyle(0x001133, 0.7)
    g.fillCircle(cx, cy, r + 6)
    g.lineStyle(1.5, 0x4488aa, 0.6)
    g.strokeCircle(cx, cy, r + 6)

    // Cardinal directions (tiny dots)
    g.fillStyle(0x4488aa, 0.5)
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8
      g.fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2)
    }

    // Boat heading arrow (blue)
    const hx = Math.cos(heading)
    const hy = Math.sin(heading)
    g.lineStyle(3, 0x4488ff, 0.9)
    g.beginPath()
    g.moveTo(cx - hx * (r - 5), cy - hy * (r - 5))
    g.lineTo(cx + hx * (r - 5), cy + hy * (r - 5))
    g.strokePath()

    // Arrow head for heading
    const headSize = 7
    const left = heading + Math.PI * 0.75
    const right = heading - Math.PI * 0.75
    const tipX = cx + hx * (r - 5)
    const tipY = cy + hy * (r - 5)
    g.fillStyle(0x4488ff, 0.9)
    g.beginPath()
    g.moveTo(tipX, tipY)
    g.lineTo(tipX + Math.cos(left) * headSize, tipY + Math.sin(left) * headSize)
    g.lineTo(tipX + Math.cos(right) * headSize, tipY + Math.sin(right) * headSize)
    g.closePath()
    g.fillPath()

    // Wind direction arrow (white/light)
    const wx = Math.cos(windDir)
    const wy = Math.sin(windDir)
    g.lineStyle(2, 0xffffff, 0.8)
    g.beginPath()
    g.moveTo(cx - wx * (r - 8), cy - wy * (r - 8))
    g.lineTo(cx + wx * (r - 8), cy + wy * (r - 8))
    g.strokePath()

    // Wind arrow tip (triangle)
    const wHeadSize = 6
    const wLeft = windDir + Math.PI * 0.75
    const wRight = windDir - Math.PI * 0.75
    const wTipX = cx + wx * (r - 8)
    const wTipY = cy + wy * (r - 8)
    g.fillStyle(0xffffff, 0.8)
    g.beginPath()
    g.moveTo(wTipX, wTipY)
    g.lineTo(wTipX + Math.cos(wLeft) * wHeadSize, wTipY + Math.sin(wLeft) * wHeadSize)
    g.lineTo(wTipX + Math.cos(wRight) * wHeadSize, wTipY + Math.sin(wRight) * wHeadSize)
    g.closePath()
    g.fillPath()

    // Center dot
    g.fillStyle(0xffffff, 1)
    g.fillCircle(cx, cy, 3)

    // "W" label for wind
    // (skip text in graphics, use the existing text elements)
  }

  private drawSailHint(cx: number, cy: number): void {
    const g = this.hudGraphics
    const r = 28

    // Background
    g.fillStyle(0x001133, 0.6)
    g.fillRoundedRect(cx - r - 30, cy - r - 4, (r + 30) * 2, r * 2 + 12, 8)

    // Optimal range arc (green)
    const OPTIMAL = Math.PI * 0.6
    const SWEET = Math.PI / 9
    const GOOD = Math.PI / 4.5

    // Draw arcs relative to wind direction
    const windDir = this.wind.direction

    // Good range arc (yellow)
    g.lineStyle(6, 0xffdd44, 0.4)
    g.beginPath()
    g.arc(cx, cy, r, windDir + OPTIMAL - GOOD, windDir + OPTIMAL + GOOD)
    g.strokePath()

    // Sweet spot arc (green)
    g.lineStyle(6, 0x44ff88, 0.7)
    g.beginPath()
    g.arc(cx, cy, r, windDir + OPTIMAL - SWEET, windDir + OPTIMAL + SWEET)
    g.strokePath()

    // Current sail position indicator
    const sailDir = this.boat.sailAngle
    const sx = cx + Math.cos(sailDir) * r
    const sy = cy + Math.sin(sailDir) * r

    const sailColors: Record<string, number> = { green: 0x44ff88, yellow: 0xffdd44, red: 0xff6644 }
    const sailColor = sailColors[this.lastThrust.quality]

    g.fillStyle(sailColor, 1)
    g.fillCircle(sx, sy, 5)
    g.lineStyle(1.5, sailColor, 0.8)
    g.beginPath()
    g.moveTo(cx, cy)
    g.lineTo(sx, sy)
    g.strokePath()

    // Wind direction indicator on the arc
    const windX = cx + Math.cos(windDir) * (r - 8)
    const windY = cy + Math.sin(windDir) * (r - 8)
    g.fillStyle(0xffffff, 0.8)
    g.fillCircle(windX, windY, 3)

    // Center circle
    g.lineStyle(1, 0x4488aa, 0.5)
    g.strokeCircle(cx, cy, r)
    g.fillStyle(0x001133, 0.8)
    g.fillCircle(cx, cy, 4)
  }

  private showGameOver(): void {
    this.gameOver = true
    this.isDragging = false

    const w = this.scale.width
    const h = this.scale.height
    const meters = Math.floor(this.totalDistance * this.METERS_PER_UNIT)

    // Overlay
    const overlay = this.add.graphics()
    overlay.fillStyle(0x000022, 0.75)
    overlay.fillRect(0, 0, w, h)
    overlay.setDepth(50)

    // Panel
    const panelW = Math.min(w * 0.85, 400)
    const panelH = Math.min(h * 0.55, 320)
    const panelX = w / 2 - panelW / 2
    const panelY = h / 2 - panelH / 2

    const panel = this.add.graphics()
    panel.setDepth(51)

    // Panel background with ocean theme
    panel.fillStyle(0x0a1e40, 1)
    panel.fillRoundedRect(panelX, panelY, panelW, panelH, 16)
    panel.lineStyle(2, 0x4488cc, 1)
    panel.strokeRoundedRect(panelX, panelY, panelW, panelH, 16)

    // Top accent
    panel.fillStyle(0x1a3a70, 1)
    panel.fillRoundedRect(panelX, panelY, panelW, panelH * 0.35, 16)
    panel.fillStyle(0x1a3a70, 1)
    panel.fillRect(panelX, panelY + panelH * 0.25, panelW, panelH * 0.1)

    const fs = Math.min(w * 0.06, 32)

    // Title
    const overTitle = this.add.text(w / 2, panelY + 30, 'VOYAGE COMPLETE!', {
      fontSize: fs + 'px',
      fontFamily: 'Georgia, serif',
      color: '#e8f4ff',
      stroke: '#000033',
      strokeThickness: 4,
    })
    overTitle.setOrigin(0.5, 0)
    overTitle.setDepth(52)

    // Score display
    const scoreLabel = this.add.text(w / 2, panelY + panelH * 0.42, 'DISTANCE SAILED', {
      fontSize: Math.floor(fs * 0.55) + 'px',
      fontFamily: 'Arial, sans-serif',
      color: '#88aacc',
    })
    scoreLabel.setOrigin(0.5)
    scoreLabel.setDepth(52)

    const scoreDisplay = this.add.text(w / 2, panelY + panelH * 0.57, `${meters}m`, {
      fontSize: Math.floor(fs * 1.4) + 'px',
      fontFamily: 'Georgia, serif',
      color: '#44ddff',
      stroke: '#001133',
      strokeThickness: 5,
    })
    scoreDisplay.setOrigin(0.5)
    scoreDisplay.setDepth(52)

    // Rating
    const rating = this.getRating(meters)
    const ratingText = this.add.text(w / 2, panelY + panelH * 0.72, rating.text, {
      fontSize: Math.floor(fs * 0.65) + 'px',
      fontFamily: 'Georgia, serif',
      color: rating.color,
    })
    ratingText.setOrigin(0.5)
    ratingText.setDepth(52)

    // Play again button
    const btnW2 = Math.min(panelW * 0.7, 220)
    const btnH2 = 48
    const btnX2 = w / 2 - btnW2 / 2
    const btnY2 = panelY + panelH - 64

    const btnBg2 = this.add.graphics()
    btnBg2.setDepth(52)
    this.drawPanelButton(btnBg2, btnX2, btnY2, btnW2, btnH2, false)

    const btnTxt2 = this.add.text(w / 2, btnY2 + btnH2 / 2, 'SAIL AGAIN', {
      fontSize: Math.floor(fs * 0.75) + 'px',
      fontFamily: 'Georgia, serif',
      color: '#ffffff',
      stroke: '#002255',
      strokeThickness: 3,
    })
    btnTxt2.setOrigin(0.5)
    btnTxt2.setDepth(53)

    const btnZone2 = this.add.zone(w / 2, btnY2 + btnH2 / 2, btnW2 + 20, btnH2 + 20).setInteractive()
    btnZone2.setDepth(54)

    btnZone2.on('pointerover', () => this.drawPanelButton(btnBg2, btnX2, btnY2, btnW2, btnH2, true))
    btnZone2.on('pointerout', () => this.drawPanelButton(btnBg2, btnX2, btnY2, btnW2, btnH2, false))
    btnZone2.on('pointerdown', () => {
      this.scene.restart()
    })

    // Animate score counting up
    let displayedMeters = 0
    const countUp = this.time.addEvent({
      delay: 16,
      repeat: 60,
      callback: () => {
        displayedMeters = Math.min(meters, displayedMeters + Math.ceil(meters / 60))
        scoreDisplay.setText(`${displayedMeters}m`)
      },
    })
  }

  private getRating(meters: number): { text: string; color: string } {
    if (meters >= 600) return { text: 'MASTER SAILOR! Extraordinary!', color: '#ffdd44' }
    if (meters >= 420) return { text: 'EXPERT! Excellent sailing!', color: '#44ff88' }
    if (meters >= 240) return { text: 'SKILLED! Great run!', color: '#44aaff' }
    if (meters >= 100) return { text: 'CAPABLE! Good effort!', color: '#aaaaff' }
    return { text: 'NOVICE. Keep practicing!', color: '#aaaaaa' }
  }

  private drawPanelButton(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, hovered: boolean): void {
    g.clear()
    const mainColor = hovered ? 0x2266bb : 0x1a4a8a
    const borderColor = hovered ? 0x66aaff : 0x4488cc

    g.fillStyle(mainColor, 1)
    g.fillRoundedRect(x, y, w, h, 10)
    g.fillStyle(0xffffff, 0.12)
    g.fillRoundedRect(x + 2, y + 2, w - 4, h / 2 - 2, 8)
    g.lineStyle(2, borderColor, 1)
    g.strokeRoundedRect(x, y, w, h, 10)
  }

  private onResize(): void {
    const w = this.scale.width
    const h = this.scale.height

    // Reposition HUD elements
    if (this.scoreText) {
      this.scoreText.setPosition(w - 16, 16)
    }

    if (this.world) {
      this.world.resize()
    }
  }

  shutdown(): void {
    this.scale.off('resize', this.onResize, this)
    if (this.boat) this.boat.destroy()
    if (this.world) this.world.destroy()
  }
}

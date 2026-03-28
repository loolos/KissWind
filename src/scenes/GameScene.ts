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
  OPTIMAL_ANGLE,
  GREEN_ZONE_HALF_WIDTH,
  YELLOW_ZONE_OUTER_HALF_WIDTH,
} from '../game/Physics'
import { MAP_ZOOM_LEVELS } from '../game/mapConfig'
import { AmbientMusic } from '../game/AmbientMusic'
import { WaterCurrent } from '../game/WaterCurrent'

const GAME_DURATION = 180  // seconds

export class GameScene extends Phaser.Scene {
  // Core systems
  private boat!: Boat
  private wind!: Wind
  private world!: World
  private waterCurrent!: WaterCurrent

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
  private speedGaugeText!: Phaser.GameObjects.Text
  private accelText!: Phaser.GameObjects.Text
  private windText!: Phaser.GameObjects.Text

  // Game state
  private timeLeft: number = GAME_DURATION
  private totalDistance: number = 0
  private gameOver: boolean = false
  private gameOverContainer!: Phaser.GameObjects.Container
  private currentWindStrength: number = 1.0
  private currentAcceleration: number = 0
  private currentSpeed: number = 0
  private currentHeading: number = 0

  /** Index into MAP_ZOOM_LEVELS; 0 = 20 (default). */
  private mapZoomIndex: number = 0
  /** Baseline span (px) while two fingers are down; 0 = not pinching. */
  private pinchBaseDist: number = 0
  private zoomMinusGfx!: Phaser.GameObjects.Graphics
  private zoomPlusGfx!: Phaser.GameObjects.Graphics
  private zoomMinusZone!: Phaser.GameObjects.Zone
  private zoomPlusZone!: Phaser.GameObjects.Zone

  private ambient!: AmbientMusic

  // Scoring: accumulated distance in game-units (convert to "meters" for display)
  private METERS_PER_UNIT = 2

  /** HUD speed bar full scale only (not a physics cap). */
  private readonly HUD_SPEED_BAR_REF = 20
  /** Top compass: current arrow reaches ~full radius at this |current| (world units/s). */
  private readonly HUD_CURRENT_SPEED_REF = 5

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
    this.mapZoomIndex = 0
    this.pinchBaseDist = 0

    // Initialize systems
    this.wind = new Wind()
    this.waterCurrent = new WaterCurrent()
    this.world = new World(this)
    this.boat = new Boat(this)

    this.physState = {
      posX: 0,
      posY: 0,
      velX: 0,
      velY: 0,
      accX: 0,
      accY: 0,
    }
    this.currentSpeed = 0
    this.currentHeading = this.wind.direction

    this.lastThrust = { thrustX: 0, thrustY: 0, thrustMag: 0, quality: 'yellow', multiplier: 1.0 }

    // Initial sail angle: slightly off the wind for a good start
    this.boat.sailAngle = this.wind.direction + Math.PI * 0.6

    this.wind.spawnInitialZones(w, h, 0, 0, this.currentHeading)

    // HUD layer
    this.hudGraphics = this.add.graphics()
    this.hudGraphics.setDepth(20)

    this.createHUD()
    this.createZoomControls()
    this.applyMapZoom()
    this.setupInput()

    this.ambient = new AmbientMusic()
    this.ambient.start()
    this.input.once('pointerdown', () => {
      this.ambient.resume()
    })

    // Handle resize
    this.scale.on('resize', this.onResize, this)
  }

  private createHUD(): void {
    const w = this.scale.width
    const h = this.scale.height
    const fontSize = Math.max(14, Math.min(24, w * 0.04))

    // Timer (top-left; offset past map zoom buttons)
    this.timerText = this.add.text(108, 16, `TIME: ${GAME_DURATION}`, {
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

    // Boat speed readout (center of bottom sail trim dial)
    this.speedGaugeText = this.add.text(w / 2, h - 110, '0.0', {
      fontSize: Math.max(14, Math.min(22, w * 0.038)) + 'px',
      fontFamily: 'Georgia, serif',
      color: '#e8f4ff',
      stroke: '#001122',
      strokeThickness: 4,
    })
    this.speedGaugeText.setOrigin(0.5)
    this.speedGaugeText.setDepth(25)

    // Acceleration indicator text (below timer)
    this.accelText = this.add.text(108, 16 + fontSize + 8, 'ACC: 0.00', {
      fontSize: Math.floor(fontSize * 0.8) + 'px',
      fontFamily: 'Arial, sans-serif',
      color: '#aaddff',
      stroke: '#000033',
      strokeThickness: 3,
    })
    this.accelText.setDepth(25)

    // Wind instrument label/value (top-center, below compass)
    this.windText = this.add.text(w / 2, 82, 'WIND 1.0', {
      fontSize: Math.floor(fontSize * 0.72) + 'px',
      fontFamily: 'Arial, sans-serif',
      color: '#e8f4ff',
      stroke: '#000033',
      strokeThickness: 3,
    })
    this.windText.setOrigin(0.5, 0)
    this.windText.setDepth(25)
  }

  /** Upper-left map zoom: − = zoom out (smaller coefficient), + = zoom in. */
  private createZoomControls(): void {
    const btnW = 40
    const btnH = 30
    const gap = 6
    const x0 = 12
    const y0 = 12

    const drawBtn = (
      g: Phaser.GameObjects.Graphics,
      x: number,
      y: number,
      hovered: boolean
    ): void => {
      g.clear()
      const fill = hovered ? 0x335588 : 0x1a3a5a
      g.fillStyle(fill, 0.92)
      g.fillRoundedRect(x, y, btnW, btnH, 6)
      g.lineStyle(1.5, 0x66aacc, 0.85)
      g.strokeRoundedRect(x, y, btnW, btnH, 6)
    }

    const mk = (
      x: number,
      label: string,
      deltaIndex: number
    ): { g: Phaser.GameObjects.Graphics; z: Phaser.GameObjects.Zone } => {
      const g = this.add.graphics().setDepth(26)
      drawBtn(g, x, y0, false)
      this.add
        .text(x + btnW / 2, y0 + btnH / 2, label, {
          fontSize: '20px',
          fontFamily: 'Arial, sans-serif',
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setDepth(27)
      const z = this.add
        .zone(x + btnW / 2, y0 + btnH / 2, btnW + 10, btnH + 10)
        .setInteractive({ useHandCursor: true })
        .setDepth(28)
      z.on('pointerover', () => drawBtn(g, x, y0, true))
      z.on('pointerout', () => drawBtn(g, x, y0, false))
      z.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        pointer.event.stopPropagation()
        this.stepMapZoom(deltaIndex)
      })
      return { g, z }
    }

    const a = mk(x0, '-', 1)
    const b = mk(x0 + btnW + gap, '+', -1)
    this.zoomMinusGfx = a.g
    this.zoomMinusZone = a.z
    this.zoomPlusGfx = b.g
    this.zoomPlusZone = b.z
  }

  private stepMapZoom(deltaIndex: number): void {
    if (this.gameOver) return
    const max = MAP_ZOOM_LEVELS.length - 1
    const next = Phaser.Math.Clamp(this.mapZoomIndex + deltaIndex, 0, max)
    if (next === this.mapZoomIndex) return
    this.mapZoomIndex = next
    this.applyMapZoom()
  }

  private applyMapZoom(): void {
    const z = MAP_ZOOM_LEVELS[this.mapZoomIndex]
    this.world.setMapZoom(z)
    this.wind.setMapZoom(z)
    this.world.resize(this.physState.posX, this.physState.posY)
  }

  private isPointerOverMapZoom(pointer: Phaser.Input.Pointer): boolean {
    return (
      (this.zoomMinusZone && this.zoomMinusZone.getBounds().contains(pointer.x, pointer.y)) ||
      (this.zoomPlusZone && this.zoomPlusZone.getBounds().contains(pointer.x, pointer.y))
    )
  }

  private setupInput(): void {
    this.input.on('pointerdown', this.onPointerDown, this)
    this.input.on('pointermove', this.onPointerMove, this)
    this.input.on('pointerup', this.onPointerUp, this)
    this.input.on('pointerupoutside', this.onPointerUp, this)
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this)
  }

  private onPointerWheel(
    _pointer: Phaser.Input.Pointer,
    _gameObjects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
    _deltaZ: number
  ): void {
    if (this.gameOver) return
    if (deltaY === 0) return
    // Scroll down (deltaY > 0) → zoom out (larger map index); scroll up → zoom in.
    this.stepMapZoom(deltaY > 0 ? 1 : -1)
  }

  /** Touch pointers currently down (excludes mouse). */
  private activeTouchPointers(): Phaser.Input.Pointer[] {
    return this.input.manager.pointers.filter((p) => p.active && p.isDown && p.wasTouch)
  }

  private touchPinchDistance(): number {
    const pts = this.activeTouchPointers().sort((a, b) => a.identifier - b.identifier)
    if (pts.length < 2) return 0
    const [a, b] = pts
    return Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)
  }

  private updatePinchZoom(): void {
    const touches = this.activeTouchPointers()
    if (touches.length < 2) {
      this.pinchBaseDist = 0
      return
    }
    const dist = this.touchPinchDistance()
    if (dist < 24) return
    if (this.pinchBaseDist <= 0) {
      this.pinchBaseDist = dist
      return
    }
    const ratio = dist / this.pinchBaseDist
    if (ratio > 1.12) {
      this.stepMapZoom(-1)
      this.pinchBaseDist = dist
    } else if (ratio < 0.88) {
      this.stepMapZoom(1)
      this.pinchBaseDist = dist
    }
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.gameOver) return
    if (this.isPointerOverMapZoom(pointer)) return
    const touches = this.activeTouchPointers()
    if (touches.length >= 2) {
      this.isDragging = false
      this.pinchBaseDist = this.touchPinchDistance()
      return
    }
    this.isDragging = true
    this.dragStartX = pointer.x
    this.dragStartY = pointer.y
    this.sailAngleAtDragStart = this.boat.sailAngle
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.gameOver) return
    if (this.activeTouchPointers().length >= 2) {
      this.updatePinchZoom()
      return
    }
    if (!this.isDragging) return

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
    if (this.activeTouchPointers().length < 2) {
      this.pinchBaseDist = 0
    }
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.05)  // cap at 50ms

    this.ambient.setBoatSpeed(this.currentSpeed)
    this.ambient.update(dt)

    if (this.gameOver) return

    // Update timer
    this.timeLeft -= dt
    if (this.timeLeft <= 0) {
      this.timeLeft = 0
      this.showGameOver()
      return
    }

    // Update wind
    this.wind.update(
      dt,
      this.physState.posX,
      this.physState.posY,
      this.scale.width,
      this.scale.height,
      this.currentHeading
    )

    this.waterCurrent.update(dt)
    const curX = this.waterCurrent.velX
    const curY = this.waterCurrent.velY

    // Get effective wind strength at boat position
    const effectiveStrength = this.wind.getStrengthAt(this.physState.posX, this.physState.posY)
    this.currentWindStrength = effectiveStrength

    // Compute thrust
    this.lastThrust = computeThrust(
      this.boat.sailAngle,
      this.wind.direction,
      effectiveStrength
    )

    // Update physics (vel = motion relative to water; current adds to ground track)
    const prevPos = { x: this.physState.posX, y: this.physState.posY }
    const prevGx = this.physState.velX + curX
    const prevGy = this.physState.velY + curY
    const prevGroundSpeed = Math.sqrt(prevGx * prevGx + prevGy * prevGy)
    this.physState = updatePhysics(
      this.physState,
      this.lastThrust.thrustX,
      this.lastThrust.thrustY,
      dt,
      curX,
      curY
    )
    const gx = this.physState.velX + curX
    const gy = this.physState.velY + curY
    this.currentSpeed = Math.sqrt(gx * gx + gy * gy)
    if (this.currentSpeed > 1e-6) {
      this.currentHeading = Math.atan2(gy, gx)
    }
    this.currentAcceleration = dt > 0 ? (this.currentSpeed - prevGroundSpeed) / dt : 0

    // Accumulate distance
    const dx = this.physState.posX - prevPos.x
    const dy = this.physState.posY - prevPos.y
    this.totalDistance += Math.sqrt(dx * dx + dy * dy)

    // Update boat visual
    this.boat.update(dt, this.currentHeading, this.currentSpeed, this.lastThrust.quality, this.world.mapZoom)

    // World map: all entities use world coords; boat-centered projection in World
    this.world.update(
      dt,
      this.physState.posX,
      this.physState.posY,
      this.wind.direction,
      effectiveStrength,
      this.wind.zones,
      this.waterCurrent.direction,
      this.waterCurrent.speed
    )

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

    // Acceleration (specific value applied to boat speed each second)
    const accelColor =
      this.currentAcceleration > 0.05 ? '#44ff88' : this.currentAcceleration < -0.05 ? '#ff6644' : '#aaddff'
    this.accelText.setColor(accelColor)
    this.accelText.setText(`ACC: ${this.currentAcceleration.toFixed(2)}`)

    // Draw HUD graphics
    this.hudGraphics.clear()

    // Background panels
    const panelAlpha = 0.45
    const hudFs = Math.max(14, Math.min(24, w * 0.04))
    const leftPanelH = 16 + hudFs + 8 + Math.floor(hudFs * 0.8) + 12
    this.hudGraphics.fillStyle(0x000022, panelAlpha)
    this.hudGraphics.fillRoundedRect(8, 8, 220, leftPanelH, 8)

    this.hudGraphics.fillStyle(0x000022, panelAlpha)
    this.hudGraphics.fillRoundedRect(w - 120, 8, 112, 36, 8)

    // Wind + heading compass (top-center); aqua arrow = water current (length ∝ speed)
    this.drawWindCompass(
      w / 2,
      44,
      this.wind.direction,
      this.currentHeading,
      this.waterCurrent.direction,
      this.waterCurrent.speed
    )
    this.windText.setText(`WIND ${this.currentWindStrength.toFixed(2)}`)

    const sailCx = w / 2
    const sailCy = h - 110
    const speedFracHud = Math.min(1, this.currentSpeed / this.HUD_SPEED_BAR_REF)
    const digColor =
      speedFracHud > 0.7 ? '#66ffaa' : speedFracHud > 0.4 ? '#88d4ff' : '#c8e8ff'
    this.speedGaugeText.setColor(digColor)
    this.speedGaugeText.setText(this.currentSpeed.toFixed(1))
    this.speedGaugeText.setPosition(sailCx, sailCy)
    this.speedGaugeText.setFontSize(`${Math.max(12, Math.min(20, w * 0.034))}px`)

    // Timer bar at bottom of screen
    const timerFrac = this.timeLeft / GAME_DURATION
    const timerBarH = 4
    const timerColor2 = timerFrac > 0.33 ? 0x44aaff : timerFrac > 0.16 ? 0xffdd44 : 0xff4444
    this.hudGraphics.fillStyle(0x001133, 0.7)
    this.hudGraphics.fillRect(0, h - timerBarH - 2, w, timerBarH + 2)
    this.hudGraphics.fillStyle(timerColor2, 0.9)
    this.hudGraphics.fillRect(0, h - timerBarH - 2, w * timerFrac, timerBarH + 2)

    // Sail angle hint arc (bottom-center); speed shown as central pie sector inside same dial
    this.drawSailHint(sailCx, sailCy)
  }

  private drawWindCompass(
    cx: number,
    cy: number,
    windDir: number,
    heading: number,
    currentDir: number,
    currentSpeed: number
  ): void {
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

    // Wind direction (white): fixed length; strength is in WIND label.
    const windLen = 18
    const wx = Math.cos(windDir)
    const wy = Math.sin(windDir)
    g.lineStyle(2, 0xffffff, 0.75)
    g.beginPath()
    g.moveTo(cx - wx * windLen, cy - wy * windLen)
    g.lineTo(cx + wx * windLen, cy + wy * windLen)
    g.strokePath()

    const wHeadSize = 5
    const wLeft = windDir + Math.PI * 0.75
    const wRight = windDir - Math.PI * 0.75
    const wTipX = cx + wx * windLen
    const wTipY = cy + wy * windLen
    g.fillStyle(0xffffff, 0.75)
    g.beginPath()
    g.moveTo(wTipX, wTipY)
    g.lineTo(wTipX + Math.cos(wLeft) * wHeadSize, wTipY + Math.sin(wLeft) * wHeadSize)
    g.lineTo(wTipX + Math.cos(wRight) * wHeadSize, wTipY + Math.sin(wRight) * wHeadSize)
    g.closePath()
    g.fillPath()

    // Water current (aqua): direction = flow toward, length ∝ |current|
    const curFrac = Math.min(1, currentSpeed / this.HUD_CURRENT_SPEED_REF)
    const curLen = Phaser.Math.Clamp(6 + curFrac * (r + 2), 6, r + 2)
    const cxw = Math.cos(currentDir)
    const cyw = Math.sin(currentDir)
    g.lineStyle(2.5, 0x55dde8, 0.92)
    g.beginPath()
    g.moveTo(cx - cxw * curLen, cy - cyw * curLen)
    g.lineTo(cx + cxw * curLen, cy + cyw * curLen)
    g.strokePath()

    const cHeadSize = 6
    const cLeft = currentDir + Math.PI * 0.75
    const cRight = currentDir - Math.PI * 0.75
    const cTipX = cx + cxw * curLen
    const cTipY = cy + cyw * curLen
    g.fillStyle(0x55dde8, 0.92)
    g.beginPath()
    g.moveTo(cTipX, cTipY)
    g.lineTo(cTipX + Math.cos(cLeft) * cHeadSize, cTipY + Math.sin(cLeft) * cHeadSize)
    g.lineTo(cTipX + Math.cos(cRight) * cHeadSize, cTipY + Math.sin(cRight) * cHeadSize)
    g.closePath()
    g.fillPath()

    // Boat heading arrow (blue), on top
    const hx = Math.cos(heading)
    const hy = Math.sin(heading)
    g.lineStyle(3, 0x4488ff, 0.9)
    g.beginPath()
    g.moveTo(cx - hx * (r - 5), cy - hy * (r - 5))
    g.lineTo(cx + hx * (r - 5), cy + hy * (r - 5))
    g.strokePath()

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

    // Center dot
    g.fillStyle(0xffffff, 1)
    g.fillCircle(cx, cy, 3)

    // Text: this.windText ("WIND x.xx")
  }

  private drawSailHint(cx: number, cy: number): void {
    const g = this.hudGraphics
    const scale = 2
    const r = 28 * scale

    // Background
    g.fillStyle(0x001133, 0.6)
    g.fillRoundedRect(
      cx - r - 30 * scale,
      cy - r - 4 * scale,
      (r + 30 * scale) * 2,
      r * 2 + 12 * scale,
      8 * scale
    )

    // Speed: pie sector from dial center; opening angle ∝ speed (drawn under zone arcs)
    const speedFrac = Math.min(1, this.currentSpeed / this.HUD_SPEED_BAR_REF)
    if (speedFrac > 1e-5) {
      const maxSweep = Math.PI * 1.4
      const sweep = speedFrac * maxSweep
      const startA = Math.PI * 0.62
      const sectorR = r - 5 * scale
      const c = speedFrac > 0.7 ? 0x44cc88 : speedFrac > 0.4 ? 0x44aadd : 0x5588cc
      g.fillStyle(c, 0.3)
      g.beginPath()
      g.moveTo(cx, cy)
      g.arc(cx, cy, sectorR, startA, startA + sweep, false)
      g.closePath()
      g.fillPath()
    }

    // Arcs match Physics zones: green 45° total, ±45° yellow bands each side
    const windDir = this.wind.direction

    g.lineStyle(6 * scale, 0xffdd44, 0.4)
    g.beginPath()
    g.arc(
      cx,
      cy,
      r,
      windDir + OPTIMAL_ANGLE - YELLOW_ZONE_OUTER_HALF_WIDTH,
      windDir + OPTIMAL_ANGLE + YELLOW_ZONE_OUTER_HALF_WIDTH
    )
    g.strokePath()

    g.lineStyle(6 * scale, 0x44ff88, 0.7)
    g.beginPath()
    g.arc(
      cx,
      cy,
      r,
      windDir + OPTIMAL_ANGLE - GREEN_ZONE_HALF_WIDTH,
      windDir + OPTIMAL_ANGLE + GREEN_ZONE_HALF_WIDTH
    )
    g.strokePath()

    // Current sail position indicator
    const sailDir = this.boat.sailAngle
    const sx = cx + Math.cos(sailDir) * r
    const sy = cy + Math.sin(sailDir) * r

    const sailColors: Record<string, number> = { green: 0x44ff88, yellow: 0xffdd44, gray: 0x9aa0a8 }
    const sailColor = sailColors[this.lastThrust.quality]

    g.fillStyle(sailColor, 1)
    g.fillCircle(sx, sy, 5 * scale)
    g.lineStyle(1.5 * scale, sailColor, 0.8)
    g.beginPath()
    g.moveTo(cx, cy)
    g.lineTo(sx, sy)
    g.strokePath()

    // Wind direction indicator on the arc
    const windX = cx + Math.cos(windDir) * (r - 8 * scale)
    const windY = cy + Math.sin(windDir) * (r - 8 * scale)
    g.fillStyle(0xffffff, 0.8)
    g.fillCircle(windX, windY, 3 * scale)

    // Center circle
    g.lineStyle(1 * scale, 0x4488aa, 0.5)
    g.strokeCircle(cx, cy, r)
    g.fillStyle(0x001133, 0.8)
    g.fillCircle(cx, cy, 4 * scale)
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
    if (this.windText) {
      this.windText.setPosition(w / 2, 82)
    }
    if (this.speedGaugeText) {
      this.speedGaugeText.setPosition(w / 2, h - 110)
    }

    if (this.world) {
      this.world.resize(this.physState.posX, this.physState.posY)
    }
  }

  shutdown(): void {
    this.scale.off('resize', this.onResize, this)
    this.input.off('pointerdown', this.onPointerDown, this)
    this.input.off('pointermove', this.onPointerMove, this)
    this.input.off('pointerup', this.onPointerUp, this)
    this.input.off('pointerupoutside', this.onPointerUp, this)
    this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this)
    if (this.ambient) this.ambient.destroy()
    if (this.boat) this.boat.destroy()
    if (this.world) this.world.destroy()
  }
}

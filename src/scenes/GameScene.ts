import Phaser from 'phaser'
import { Boat } from '../game/Boat'
import { Wind } from '../game/Wind'
import { World } from '../game/World'
import { hullEllipseSemiAxesWorld } from '../game/Boat'
import {
  FIXED_ROUTE_MAP,
  generateRandomRouteMap,
  getFixedMapBounds,
  type FixedMapBounds,
  type FixedRouteMap,
} from '../game/fixedMap'
import {
  firstLandHitAlongSegment,
  isPointOnAnyLand,
  nearestLandOutwardNormal,
  projectVelocityAlongLand,
} from '../game/land'
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
import { worldToScreen } from '../game/camera'
import { AmbientMusic } from '../game/AmbientMusic'
import { WaterCurrent } from '../game/WaterCurrent'
import { getMiniMapPixelLayout } from '../game/minimapLayout'
import { SeaLifeAmbience } from '../game/SeaLifeAmbience'

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
  private miniMapTitleText!: Phaser.GameObjects.Text

  // Fixed route map
  private routeMap = FIXED_ROUTE_MAP
  private routeMapBounds: FixedMapBounds = getFixedMapBounds(FIXED_ROUTE_MAP, 56)
  private routeDistance: number = 1
  private distanceToFinish: number = 0

  // Game state
  private elapsedRaceSec: number = 0
  /** After SET SAIL: 3,2,1,0 each 0.5s; timer and physics run only when true. */
  private raceLive: boolean = false
  private introCountdownElapsed: number = 0
  private readonly INTRO_COUNTDOWN_STEP_SEC = 0.5
  private readonly INTRO_COUNTDOWN_TOTAL_SEC = 2
  private countdownText!: Phaser.GameObjects.Text
  private bestTimeSec: number | null = null
  private gameOver: boolean = false
  private reachedFinish: boolean = false
  private finalTimeSec: number = 0
  private isNewRecord: boolean = false
  private currentWindStrength: number = 1
  private currentWindDirection: number = 0
  private currentSpeed: number = 0
  private currentHeading: number = 0
  private currentAcceleration: number = 0
  private totalDistance: number = 0

  /** Index into MAP_ZOOM_LEVELS; 0 = 20 (default). */
  private mapZoomIndex: number = 0
  /** Baseline span (px) while two fingers are down; 0 = not pinching. */
  private pinchBaseDist: number = 0
  private zoomMinusGfx!: Phaser.GameObjects.Graphics
  private zoomPlusGfx!: Phaser.GameObjects.Graphics
  private zoomMinusZone!: Phaser.GameObjects.Zone
  private zoomPlusZone!: Phaser.GameObjects.Zone
  private zoomMinusLabel!: Phaser.GameObjects.Text
  private zoomPlusLabel!: Phaser.GameObjects.Text

  private ambient!: AmbientMusic
  private seaLife!: SeaLifeAmbience

  // Display conversion for HUD text
  private readonly METERS_PER_UNIT = 2

  /** HUD speed bar full scale only (not a physics cap). */
  private readonly HUD_SPEED_BAR_REF = 20
  /** Top compass: current arrow reaches ~full radius at this |current| (world units/s). */
  private readonly HUD_CURRENT_SPEED_REF = 5
  /** Extra bottom margin so mobile browser bars/home indicator do not cover HUD. */
  private readonly HUD_BOTTOM_MARGIN = 18

  /** Land hit: bounce + dizzy spin; duration scales with inward ground speed (before bounce). */
  private landStunRemainingSec = 0
  private landStunTotalSec = 0
  private landStunHeadingSpin0 = 0
  private landStunSailSpin0 = 0
  private readonly LAND_IMPACT_EPS = 0.06
  private readonly LAND_BOUNCE_RETENTION = 0.64
  private readonly LAND_STUN_BASE_SEC = 0.32
  private readonly LAND_STUN_PER_IMPACT_SEC = 0.11
  private readonly LAND_STUN_MAX_SEC = 2.4

  constructor() {
    super({ key: 'GameScene' })
  }

  create(): void {
    const w = this.scale.width
    const h = this.scale.height

    // Reset game state (scene.restart() reuses the instance)
    this.gameOver = false
    this.reachedFinish = false
    this.finalTimeSec = 0
    this.isNewRecord = false
    this.elapsedRaceSec = 0
    this.raceLive = false
    this.introCountdownElapsed = 0
    this.totalDistance = 0
    this.distanceToFinish = 0
    this.isDragging = false
    this.mapZoomIndex = 0
    this.pinchBaseDist = 0
    this.landStunRemainingSec = 0
    this.landStunTotalSec = 0
    this.landStunHeadingSpin0 = 0
    this.landStunSailSpin0 = 0
    const routeOverride = this.registry.get('routeMapOverride') as FixedRouteMap | undefined
    if (routeOverride) {
      this.routeMap = routeOverride
      this.registry.remove('routeMapOverride')
    } else {
      this.routeMap = FIXED_ROUTE_MAP
    }
    this.routeMapBounds = getFixedMapBounds(this.routeMap, 56)

    // Route metrics
    const sx = this.routeMap.start.worldX
    const sy = this.routeMap.start.worldY
    const fx = this.routeMap.finish.worldX
    const fy = this.routeMap.finish.worldY
    this.routeDistance = Math.max(1, Phaser.Math.Distance.Between(sx, sy, fx, fy))
    this.distanceToFinish = this.routeDistance
    this.bestTimeSec = this.loadBestTime()

    // Initialize systems
    this.wind = new Wind(this.routeMap)
    this.wind.setMinimapHomingRefFromViewport(w, h)
    this.waterCurrent = new WaterCurrent()
    this.world = new World(this, this.routeMap)
    this.boat = new Boat(this)
    this.seaLife = new SeaLifeAmbience(this)

    this.physState = {
      posX: sx,
      posY: sy,
      velX: 0,
      velY: 0,
      accX: 0,
      accY: 0,
    }

    const initialWind = this.wind.getWindAt(sx, sy)
    this.currentWindDirection = initialWind.direction
    this.currentWindStrength = initialWind.strength
    this.currentSpeed = 0
    this.currentHeading = this.currentWindDirection
    this.currentAcceleration = 0

    this.lastThrust = { thrustX: 0, thrustY: 0, thrustMag: 0, quality: 'yellow', multiplier: 1.0 }

    // Initial sail angle: slightly off local wind
    this.boat.sailAngle = this.currentWindDirection + Math.PI * 0.6
    this.boat.targetSailAngle = this.boat.sailAngle

    this.wind.spawnInitialZones(w, h, sx, sy, this.currentHeading)

    // HUD layer
    this.hudGraphics = this.add.graphics()
    this.hudGraphics.setDepth(20)
    this.createHUD()
    this.createCountdownOverlay()
    this.createZoomControls()
    this.applyMapZoom()
    this.setupInput()

    this.ambient = new AmbientMusic()
    this.ambient.start()
    this.input.once('pointerdown', () => this.ambient.resume())

    // Handle resize
    this.scale.on('resize', this.onResize, this)
  }

  private createHUD(): void {
    const w = this.scale.width
    const { sailCy } = this.getHudLayout()
    const fontSize = Math.max(14, Math.min(24, w * 0.04))

    this.timerText = this.add.text(108, 16, 'TIME: 0.0s', {
      fontSize: `${fontSize}px`,
      fontFamily: 'Georgia, serif',
      color: '#ffffff',
      stroke: '#000033',
      strokeThickness: 4,
    })
    this.timerText.setDepth(25)

    this.scoreText = this.add.text(w - 16, 16, 'TO GO: 0m', {
      fontSize: `${fontSize}px`,
      fontFamily: 'Georgia, serif',
      color: '#ffffff',
      stroke: '#000033',
      strokeThickness: 4,
    })
    this.scoreText.setOrigin(1, 0)
    this.scoreText.setDepth(25)

    this.speedGaugeText = this.add.text(w / 2, sailCy, '0.0', {
      fontSize: `${Math.max(14, Math.min(22, w * 0.038))}px`,
      fontFamily: 'Georgia, serif',
      color: '#e8f4ff',
      stroke: '#001122',
      strokeThickness: 4,
    })
    this.speedGaugeText.setOrigin(0.5)
    this.speedGaugeText.setDepth(25)

    this.accelText = this.add.text(108, 16 + fontSize + 8, 'BEST: --', {
      fontSize: `${Math.floor(fontSize * 0.8)}px`,
      fontFamily: 'Arial, sans-serif',
      color: '#aaddff',
      stroke: '#000033',
      strokeThickness: 3,
    })
    this.accelText.setDepth(25)

    this.windText = this.add.text(w / 2, 82, 'WIND 1.0', {
      fontSize: `${Math.floor(fontSize * 0.72)}px`,
      fontFamily: 'Arial, sans-serif',
      color: '#e8f4ff',
      stroke: '#000033',
      strokeThickness: 3,
    })
    this.windText.setOrigin(0.5, 0)
    this.windText.setDepth(25)

    this.miniMapTitleText = this.add.text(0, 0, 'ROUTE MAP', {
      fontSize: `${Math.max(10, Math.min(16, w * 0.028))}px`,
      fontFamily: 'Arial, sans-serif',
      color: '#d8eeff',
      stroke: '#001122',
      strokeThickness: 3,
    })
    this.miniMapTitleText.setDepth(25)
  }

  private createCountdownOverlay(): void {
    const w = this.scale.width
    const h = this.scale.height
    const fontPx = Math.round(Math.min(w, h) * 0.28)
    this.countdownText = this.add
      .text(w / 2, h / 2, '3', {
        fontSize: `${fontPx}px`,
        fontFamily: 'Georgia, serif',
        color: '#ffffff',
        stroke: '#001a33',
        strokeThickness: Math.max(6, Math.round(fontPx * 0.08)),
      })
      .setOrigin(0.5)
      .setDepth(100)
      .setScrollFactor(0)
      .setVisible(true)
  }

  /** Upper-left map zoom: − = zoom out (smaller coefficient), + = zoom in. */
  private createZoomControls(): void {
    const w = this.scale.width
    const btnW = Math.round(Phaser.Math.Clamp(w * 0.11, 34, 44))
    const btnH = Math.round(Phaser.Math.Clamp(btnW * 0.74, 24, 32))
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
      const labelObj = this.add
        .text(x + btnW / 2, y0 + btnH / 2, label, {
          fontSize: `${Math.round(btnH * 0.62)}px`,
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
      if (label === '-') this.zoomMinusLabel = labelObj
      else this.zoomPlusLabel = labelObj
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
    if (this.gameOver || !this.raceLive) return
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
    // Do not call world.resize here — that would respawn debris/waves and jump props; zoom only changes projection.
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
    if (this.gameOver || !this.raceLive) return
    if (deltaY === 0) return
    this.stepMapZoom(deltaY > 0 ? 1 : -1)
  }

  private activeTouchPointers(): Phaser.Input.Pointer[] {
    return this.input.manager.pointers.filter((p) => {
      if (!p.active || !p.isDown) return false
      const pointerType = (p as Phaser.Input.Pointer & { pointerType?: string }).pointerType
      return pointerType === 'touch' || p.wasTouch || p.id > 0
    })
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
    if (dist < 20) return
    if (this.pinchBaseDist <= 0) {
      this.pinchBaseDist = dist
      return
    }
    const ratio = dist / this.pinchBaseDist
    if (ratio > 1.08) {
      this.stepMapZoom(-1)
      this.pinchBaseDist = dist
    } else if (ratio < 0.92) {
      this.stepMapZoom(1)
      this.pinchBaseDist = dist
    }
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.gameOver || !this.raceLive) return
    if (this.landStunRemainingSec > 0) return
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
    if (this.gameOver || !this.raceLive) return
    if (this.activeTouchPointers().length >= 2) {
      this.updatePinchZoom()
      return
    }
    if (!this.isDragging) return
    if (this.landStunRemainingSec > 0) return

    const cx = this.scale.width / 2
    const cy = this.scale.height / 2
    const currentAngle = Math.atan2(pointer.y - cy, pointer.x - cx)
    const startAngle = Math.atan2(this.dragStartY - cy, this.dragStartX - cx)
    const deltaAngle = normalizeAngle(currentAngle - startAngle)
    this.boat.targetSailAngle = this.sailAngleAtDragStart + deltaAngle
  }

  private onPointerUp(_pointer: Phaser.Input.Pointer): void {
    this.isDragging = false
    if (this.activeTouchPointers().length < 2) this.pinchBaseDist = 0
  }

  /** During countdown: animate sea/wind/life and draw the boat; no race timer or physics drift. */
  private stepWindSeaAndRenderDuringIntro(dt: number): void {
    this.wind.setMinimapHomingRefFromViewport(this.scale.width, this.scale.height)
    this.wind.update(
      dt,
      this.physState.posX,
      this.physState.posY,
      this.scale.width,
      this.scale.height,
      this.currentHeading
    )
    this.waterCurrent.update(dt)

    const localWind = this.wind.getWindAt(this.physState.posX, this.physState.posY)
    this.currentWindDirection = localWind.direction
    this.currentWindStrength = localWind.strength

    this.boat.stepSailTowardTarget(dt)
    this.lastThrust = computeThrust(
      this.boat.sailAngle,
      this.currentWindDirection,
      this.currentWindStrength
    )

    this.currentSpeed = 0
    this.currentAcceleration = 0

    this.boat.update(
      dt,
      this.currentHeading,
      0,
      this.lastThrust.quality,
      this.world.mapZoom
    )

    this.world.update(
      dt,
      this.physState.posX,
      this.physState.posY,
      this.currentWindDirection,
      this.currentWindStrength,
      this.wind.zones,
      this.waterCurrent.direction,
      this.waterCurrent.speed
    )

    this.seaLife.update(
      dt,
      this.physState.posX,
      this.physState.posY,
      this.world.mapZoom,
      this.scale.width,
      this.scale.height
    )
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.05)

    this.ambient.setBoatSpeed(this.currentSpeed)
    this.ambient.update(dt)
    if (this.gameOver) return

    if (!this.raceLive) {
      this.introCountdownElapsed += dt
      if (this.introCountdownElapsed < this.INTRO_COUNTDOWN_TOTAL_SEC) {
        const step = Math.floor(this.introCountdownElapsed / this.INTRO_COUNTDOWN_STEP_SEC)
        const n = 3 - Math.min(3, step)
        this.countdownText.setText(String(n))
        this.stepWindSeaAndRenderDuringIntro(dt)
        this.updateHUD()
        return
      }
      this.countdownText.setVisible(false)
      this.raceLive = true
    }

    this.elapsedRaceSec += dt

    this.wind.setMinimapHomingRefFromViewport(this.scale.width, this.scale.height)
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

    const localWind = this.wind.getWindAt(this.physState.posX, this.physState.posY)
    this.currentWindDirection = localWind.direction
    this.currentWindStrength = localWind.strength

    if (this.landStunRemainingSec <= 0) {
      this.boat.stepSailTowardTarget(dt)
    }
    this.lastThrust = computeThrust(
      this.boat.sailAngle,
      this.currentWindDirection,
      this.currentWindStrength
    )
    if (this.landStunRemainingSec > 0) {
      this.lastThrust = {
        ...this.lastThrust,
        thrustX: 0,
        thrustY: 0,
        thrustMag: 0,
        multiplier: 0,
        quality: 'gray',
      }
    }

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

    this.resolveLandCollision(prevPos.x, prevPos.y, curX, curY)

    const hit = this.world.applyBoatDebrisCollision(
      this.physState.posX,
      this.physState.posY,
      this.physState.velX,
      this.physState.velY,
      this.world.mapZoom,
      this.currentHeading
    )
    this.physState.velX += hit.dvx
    this.physState.velY += hit.dvy

    const gx = this.physState.velX + curX
    const gy = this.physState.velY + curY
    this.currentSpeed = Math.sqrt(gx * gx + gy * gy)
    if (this.landStunRemainingSec > 0) {
      const spinEase = this.landStunRemainingSec / Math.max(this.landStunTotalSec, 1e-6)
      this.currentHeading += this.landStunHeadingSpin0 * spinEase * dt
      this.boat.sailAngle += this.landStunSailSpin0 * spinEase * dt
      this.landStunRemainingSec -= dt
      if (this.landStunRemainingSec <= 0) {
        this.landStunRemainingSec = 0
        if (this.currentSpeed > 1e-6) this.currentHeading = Math.atan2(gy, gx)
        this.boat.targetSailAngle = this.boat.sailAngle
      }
    } else if (this.currentSpeed > 1e-6) {
      this.currentHeading = Math.atan2(gy, gx)
    }
    this.currentAcceleration = dt > 0 ? (this.currentSpeed - prevGroundSpeed) / dt : 0

    const dx = this.physState.posX - prevPos.x
    const dy = this.physState.posY - prevPos.y
    this.totalDistance += Math.sqrt(dx * dx + dy * dy)

    this.distanceToFinish = Phaser.Math.Distance.Between(
      this.physState.posX,
      this.physState.posY,
      this.routeMap.finish.worldX,
      this.routeMap.finish.worldY
    )

    this.boat.update(
      dt,
      this.currentHeading,
      this.currentSpeed,
      this.lastThrust.quality,
      this.world.mapZoom
    )

    this.world.update(
      dt,
      this.physState.posX,
      this.physState.posY,
      this.currentWindDirection,
      this.currentWindStrength,
      this.wind.zones,
      this.waterCurrent.direction,
      this.waterCurrent.speed
    )

    this.seaLife.update(
      dt,
      this.physState.posX,
      this.physState.posY,
      this.world.mapZoom,
      this.scale.width,
      this.scale.height
    )

    this.updateHUD()

    if (this.distanceToFinish <= this.routeMap.finish.radius) {
      this.completeVoyage()
    }
  }

  private updateHUD(): void {
    const w = this.scale.width
    const h = this.scale.height
    const { sailCy } = this.getHudLayout()

    this.timerText.setColor('#ffffff')
    this.timerText.setText(`TIME: ${this.elapsedRaceSec.toFixed(1)}s`)

    const toGoM = Math.max(0, Math.floor(this.distanceToFinish * this.METERS_PER_UNIT))
    this.scoreText.setText(`TO GO: ${toGoM}m`)

    const bestText = this.bestTimeSec === null ? 'BEST: --' : `BEST: ${this.bestTimeSec.toFixed(1)}s`
    const bestColor =
      this.bestTimeSec !== null && this.elapsedRaceSec < this.bestTimeSec ? '#66ffaa' : '#aaddff'
    this.accelText.setColor(bestColor)
    this.accelText.setText(bestText)

    this.hudGraphics.clear()

    // Background panels
    const panelAlpha = 0.45
    const hudFs = Math.max(14, Math.min(24, w * 0.04))
    const leftPanelH = 16 + hudFs + 8 + Math.floor(hudFs * 0.8) + 12
    this.hudGraphics.fillStyle(0x000022, panelAlpha)
    this.hudGraphics.fillRoundedRect(8, 8, 240, leftPanelH, 8)

    this.hudGraphics.fillStyle(0x000022, panelAlpha)
    this.hudGraphics.fillRoundedRect(w - 186, 8, 178, 42, 8)

    this.drawWindCompass(
      w / 2,
      44,
      this.currentWindDirection,
      this.currentHeading,
      this.waterCurrent.direction,
      this.waterCurrent.speed
    )
    this.drawFinishWorldFlag(w, h)
    this.windText.setText(`WIND ${this.currentWindStrength.toFixed(2)}`)

    const speedFracHud = Math.min(1, this.currentSpeed / this.HUD_SPEED_BAR_REF)
    const digColor = speedFracHud > 0.7 ? '#66ffaa' : speedFracHud > 0.4 ? '#88d4ff' : '#c8e8ff'
    this.speedGaugeText.setColor(digColor)
    this.speedGaugeText.setText(this.currentSpeed.toFixed(1))
    this.speedGaugeText.setPosition(w / 2, sailCy)
    this.speedGaugeText.setFontSize(`${Math.max(12, Math.min(20, w * 0.034))}px`)

    const progress = Phaser.Math.Clamp(
      1 - this.distanceToFinish / Math.max(1, this.routeDistance),
      0,
      1
    )
    const barH = 4
    const bottomInset = Math.max(2, Math.round(this.getBottomSafePadding() * 0.45))
    const barY = h - barH - bottomInset
    this.hudGraphics.fillStyle(0x001133, 0.7)
    this.hudGraphics.fillRect(0, barY, w, barH + 2)
    this.hudGraphics.fillStyle(0x44dd88, 0.9)
    this.hudGraphics.fillRect(0, barY, w * progress, barH + 2)

    this.drawMiniMap()
    this.drawSailHint(w / 2, sailCy)
  }

  private getHudLayout(): { sailCy: number; sailScale: number } {
    const w = this.scale.width
    const h = this.scale.height
    const compact = w < 520 || h < 860
    const ultraCompact = w < 390 || h < 700
    const sailScale = ultraCompact ? 1.28 : compact ? 1.45 : 2
    const dialRadius = 28 * sailScale
    const bgHalfHeight = dialRadius + 6 * sailScale
    const safeBottom = this.getBottomSafePadding()
    const timerBarAndGap = 8
    const sailCy = Math.max(h * 0.58, h - safeBottom - timerBarAndGap - bgHalfHeight)
    return { sailCy, sailScale }
  }

  private getBottomSafePadding(): number {
    const w = this.scale.width
    const h = this.scale.height
    const compact = w < 520 || h < 860
    const ultraCompact = w < 390 || h < 700
    const tinyPhone = w <= 430 || h <= 760
    let padding = this.HUD_BOTTOM_MARGIN
    if (compact) padding += 10
    if (ultraCompact) padding += 8
    if (tinyPhone) padding += 10

    if (typeof window !== 'undefined') {
      const cssSafe = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--safe-area-bottom')
      )
      if (Number.isFinite(cssSafe) && cssSafe > 0) {
        padding += Phaser.Math.Clamp(Math.round(cssSafe), 0, 40)
      }
    }

    if (typeof window !== 'undefined') {
      const vv = window.visualViewport
      if (vv) {
        const layoutViewportH = Math.max(window.innerHeight, document.documentElement.clientHeight)
        const browserUiInset = Math.max(0, Math.round(layoutViewportH - vv.height - vv.offsetTop))
        padding += Phaser.Math.Clamp(browserUiInset, 0, 60)
      }
    }
    return padding
  }

  private getMiniMapLayout(): { x: number; y: number; w: number; h: number; pad: number } {
    const vw = this.scale.width
    const vh = this.scale.height
    const { mapW, mapH, pad } = getMiniMapPixelLayout(vw, vh)
    const x = 12
    const y = vh - this.getBottomSafePadding() - mapH - 20
    return { x, y, w: mapW, h: mapH, pad }
  }

  private drawMiniMap(): void {
    const g = this.hudGraphics
    const { x, y, w, h, pad } = this.getMiniMapLayout()

    g.fillStyle(0x000a1f, 0.62)
    g.fillRoundedRect(x, y, w, h, 9)
    g.lineStyle(1.5, 0x4a88c9, 0.8)
    g.strokeRoundedRect(x, y, w, h, 9)

    this.miniMapTitleText.setPosition(x + 4, y - 16)
    this.miniMapTitleText.setFontSize(`${Math.max(10, Math.min(16, this.scale.width * 0.028))}px`)

    const bounds = this.routeMapBounds
    const cx = x + w * 0.5
    const cy = y + h * 0.5
    const availW = w - pad * 2
    const availH = h - pad * 2
    const scale = Math.min(availW / bounds.width, availH / bounds.height)
    const mapCenterX = (bounds.minX + bounds.maxX) * 0.5
    const mapCenterY = (bounds.minY + bounds.maxY) * 0.5

    const toMini = (wx: number, wy: number): { x: number; y: number } => ({
      x: cx + (wx - mapCenterX) * scale,
      y: cy + (wy - mapCenterY) * scale,
    })

    const start = toMini(this.routeMap.start.worldX, this.routeMap.start.worldY)
    const finish = toMini(this.routeMap.finish.worldX, this.routeMap.finish.worldY)
    const boat = toMini(this.physState.posX, this.physState.posY)

    g.lineStyle(1.3, 0x66ccff, 0.6)
    g.beginPath()
    g.moveTo(start.x, start.y)
    g.lineTo(finish.x, finish.y)
    g.strokePath()

    const finishR = Math.max(4, this.routeMap.finish.radius * scale)
    g.fillStyle(0x44ff88, 0.2)
    g.fillCircle(finish.x, finish.y, finishR)
    g.lineStyle(1.1, 0x44ff88, 0.9)
    g.strokeCircle(finish.x, finish.y, finishR)

    const lands = this.routeMap.lands ?? []
    for (const land of lands) {
      g.fillStyle(0x6b5344, 0.92)
      g.lineStyle(1, 0x3a2c22, 0.95)
      if (land.kind === 'circle') {
        const p = toMini(land.worldX, land.worldY)
        g.fillCircle(p.x, p.y, Math.max(2.5, land.radius * scale))
        g.strokeCircle(p.x, p.y, Math.max(2.5, land.radius * scale))
        continue
      }
      if (land.kind === 'rect') {
        const hx = land.width * 0.5
        const hy = land.height * 0.5
        const c = Math.cos(land.rotation)
        const s = Math.sin(land.rotation)
        const corners = [
          { x: -hx, y: -hy },
          { x: hx, y: -hy },
          { x: hx, y: hy },
          { x: -hx, y: hy },
        ].map((pt) => {
          const wx = land.worldX + pt.x * c - pt.y * s
          const wy = land.worldY + pt.x * s + pt.y * c
          return toMini(wx, wy)
        })
        g.beginPath()
        g.moveTo(corners[0].x, corners[0].y)
        for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].x, corners[i].y)
        g.closePath()
        g.fillPath()
        g.strokePath()
        continue
      }
      if (land.points.length < 3) continue
      const pts = land.points.map((pt) => toMini(pt.x, pt.y))
      g.beginPath()
      g.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y)
      g.closePath()
      g.fillPath()
      g.strokePath()
    }

    for (const a of this.routeMap.windAnchors) {
      const p = toMini(a.worldX, a.worldY)
      g.fillStyle(0xaad8ff, 0.95)
      g.fillCircle(p.x, p.y, 2.2)
      const ar = 7
      const ex = p.x + Math.cos(a.direction) * ar
      const ey = p.y + Math.sin(a.direction) * ar
      g.lineStyle(1, 0xd8eeff, 0.8)
      g.beginPath()
      g.moveTo(p.x, p.y)
      g.lineTo(ex, ey)
      g.strokePath()
    }

    g.fillStyle(0xffe188, 1)
    g.fillCircle(start.x, start.y, 3.2)
    if (!this.reachedFinish) this.drawMinimapRedFlag(g, finish.x, finish.y)

    g.fillStyle(0x4488ff, 1)
    g.fillCircle(boat.x, boat.y, 3.4)
    g.lineStyle(1.2, 0x4488ff, 0.95)
    g.beginPath()
    g.moveTo(boat.x, boat.y)
    g.lineTo(
      boat.x + Math.cos(this.currentHeading) * 8,
      boat.y + Math.sin(this.currentHeading) * 8
    )
    g.strokePath()
  }

  /** Tiny red flag at minimap finish (screen pixels, not world scale). */
  private drawMinimapRedFlag(g: Phaser.GameObjects.Graphics, sx: number, sy: number): void {
    const poleH = 8
    const poleTopY = sy - poleH
    const tipX = sx + 6
    const midY = poleTopY + 3.5

    g.lineStyle(1.3, 0x2a1810, 0.95)
    g.beginPath()
    g.moveTo(sx, sy)
    g.lineTo(sx, poleTopY)
    g.strokePath()

    g.fillStyle(0xcc2222, 0.95)
    g.lineStyle(0.9, 0x5c1010, 0.9)
    g.beginPath()
    g.moveTo(sx, poleTopY)
    g.lineTo(tipX, midY)
    g.lineTo(sx, poleTopY + 5)
    g.closePath()
    g.fillPath()
    g.strokePath()
  }

  private resolveLandCollision(prevX: number, prevY: number, currentX: number, currentY: number): void {
    const lands = this.world.getLands()
    if (lands.length === 0) return
    const hull = hullEllipseSemiAxesWorld(this.world.mapZoom)
    const hullMargin = Math.max(hull.halfLen, hull.halfBeam)
    const hitT = firstLandHitAlongSegment(
      lands,
      prevX,
      prevY,
      this.physState.posX,
      this.physState.posY,
      hullMargin
    )
    if (hitT !== null) {
      const safeT = Math.max(0, hitT - 0.01)
      this.physState.posX = prevX + (this.physState.posX - prevX) * safeT
      this.physState.posY = prevY + (this.physState.posY - prevY) * safeT
    }

    const onLand =
      hitT !== null ||
      isPointOnAnyLand(lands, this.physState.posX, this.physState.posY, hullMargin)
    if (!onLand) return

    const n = nearestLandOutwardNormal(lands, this.physState.posX, this.physState.posY, hullMargin)
    if (!n) return

    const gx = this.physState.velX + currentX
    const gy = this.physState.velY + currentY
    const dotN = gx * n.nx + gy * n.ny
    /** Inward ground speed into land (same as magnitude removed by `projectVelocityAlongLand`). */
    const impact = Math.max(0, -dotN)

    if (impact > this.LAND_IMPACT_EPS) {
      const gRx = gx - 2 * dotN * n.nx
      const gRy = gy - 2 * dotN * n.ny
      const s = this.LAND_BOUNCE_RETENTION
      this.physState.velX = gRx * s - currentX
      this.physState.velY = gRy * s - currentY

      const dur = Math.min(
        this.LAND_STUN_MAX_SEC,
        this.LAND_STUN_BASE_SEC + this.LAND_STUN_PER_IMPACT_SEC * impact
      )
      this.landStunTotalSec = dur
      this.landStunRemainingSec = dur
      const hAmp = Math.min(2.9, 1.05 + impact * 0.24)
      const sAmp = Math.min(3.4, 1.35 + impact * 0.3)
      this.landStunHeadingSpin0 = Math.PI * 2 * hAmp * (Math.random() < 0.5 ? -1 : 1)
      this.landStunSailSpin0 = Math.PI * 2 * sAmp * (Math.random() < 0.5 ? -1 : 1)
    } else {
      const ground = projectVelocityAlongLand(gx, gy, n.nx, n.ny)
      this.physState.velX = ground.velX - currentX
      this.physState.velY = ground.velY - currentY
    }
  }

  /** Main-view marker at `routeMap.finish` using the same boat-centered projection as the ocean. */
  private drawFinishWorldFlag(viewW: number, viewH: number): void {
    if (this.reachedFinish) return

    const { worldX: fx, worldY: fy } = this.routeMap.finish
    const { sx, sy } = worldToScreen(
      fx,
      fy,
      this.physState.posX,
      this.physState.posY,
      this.world.mapZoom,
      viewW,
      viewH
    )

    const margin = 48
    if (sx < -margin || sy < -margin || sx > viewW + margin || sy > viewH + margin) return

    const g = this.hudGraphics
    const poleH = 32
    const poleTopY = sy - poleH
    const tipX = sx + 22
    const midY = poleTopY + 13

    g.lineStyle(3, 0x2a1810, 0.95)
    g.beginPath()
    g.moveTo(sx, sy)
    g.lineTo(sx, poleTopY)
    g.strokePath()

    g.fillStyle(0xcc2222, 0.95)
    g.lineStyle(1.6, 0x5c1010, 0.9)
    g.beginPath()
    g.moveTo(sx, poleTopY)
    g.lineTo(tipX, midY)
    g.lineTo(sx, poleTopY + 20)
    g.closePath()
    g.fillPath()
    g.strokePath()
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

    g.fillStyle(0x001133, 0.7)
    g.fillCircle(cx, cy, r + 6)
    g.lineStyle(1.5, 0x4488aa, 0.6)
    g.strokeCircle(cx, cy, r + 6)

    g.fillStyle(0x4488aa, 0.5)
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8
      g.fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2)
    }

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

    g.fillStyle(0xffffff, 1)
    g.fillCircle(cx, cy, 3)
  }

  private drawSailHint(cx: number, cy: number): void {
    const g = this.hudGraphics
    const { sailScale: scale } = this.getHudLayout()
    const r = 28 * scale

    g.fillStyle(0x001133, 0.6)
    g.fillRoundedRect(
      cx - r - 30 * scale,
      cy - r - 4 * scale,
      (r + 30 * scale) * 2,
      r * 2 + 12 * scale,
      8 * scale
    )

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

    const windDir = this.currentWindDirection

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

    const sailColors: Record<string, number> = { green: 0x44ff88, yellow: 0xffdd44, gray: 0x9aa0a8 }
    const sailLag = Math.abs(normalizeAngle(this.boat.targetSailAngle - this.boat.sailAngle))
    const sailLagThreshold = 0.045

    if (sailLag < sailLagThreshold) {
      const ang = this.boat.sailAngle
      const sx = cx + Math.cos(ang) * r
      const sy = cy + Math.sin(ang) * r
      const sailColor = sailColors[this.lastThrust.quality]
      g.fillStyle(sailColor, 1)
      g.fillCircle(sx, sy, 5 * scale)
      g.lineStyle(1.5 * scale, sailColor, 0.8)
      g.beginPath()
      g.moveTo(cx, cy)
      g.lineTo(sx, sy)
      g.strokePath()
    } else {
      const rAct = r * 0.72
      const actualDir = this.boat.sailAngle
      const ax = cx + Math.cos(actualDir) * rAct
      const ay = cy + Math.sin(actualDir) * rAct
      const actColor = sailColors[this.lastThrust.quality]
      g.fillStyle(actColor, 1)
      g.fillCircle(ax, ay, 3.5 * scale)
      g.lineStyle(1.2 * scale, actColor, 0.75)
      g.beginPath()
      g.moveTo(cx, cy)
      g.lineTo(ax, ay)
      g.strokePath()

      const targetDir = this.boat.targetSailAngle
      const tx = cx + Math.cos(targetDir) * r
      const ty = cy + Math.sin(targetDir) * r
      const targetStroke = 0xb8e8ff
      const targetFill = 0xe8f8ff
      g.fillStyle(targetFill, 1)
      g.fillCircle(tx, ty, 5 * scale)
      g.lineStyle(1.5 * scale, targetStroke, 0.95)
      g.beginPath()
      g.moveTo(cx, cy)
      g.lineTo(tx, ty)
      g.strokePath()
    }

    const windX = cx + Math.cos(windDir) * (r - 8 * scale)
    const windY = cy + Math.sin(windDir) * (r - 8 * scale)
    g.fillStyle(0xffffff, 0.8)
    g.fillCircle(windX, windY, 3 * scale)

    g.lineStyle(1 * scale, 0x4488aa, 0.5)
    g.strokeCircle(cx, cy, r)
    g.fillStyle(0x001133, 0.8)
    g.fillCircle(cx, cy, 4 * scale)
  }

  private completeVoyage(): void {
    if (this.gameOver) return
    this.gameOver = true
    this.reachedFinish = true
    this.isDragging = false
    this.finalTimeSec = this.elapsedRaceSec

    const oldBest = this.bestTimeSec
    if (oldBest === null || this.finalTimeSec < oldBest) {
      this.bestTimeSec = this.finalTimeSec
      this.saveBestTime(this.finalTimeSec)
      this.isNewRecord = true
    } else {
      this.isNewRecord = false
    }

    const w = this.scale.width
    const h = this.scale.height

    const overlay = this.add.graphics()
    overlay.fillStyle(0x000022, 0.75)
    overlay.fillRect(0, 0, w, h)
    overlay.setDepth(50)

    const panelW = Math.min(w * 0.86, 430)
    const panelH = Math.min(h * 0.74, 450)
    const panelX = w / 2 - panelW / 2
    const panelY = h / 2 - panelH / 2

    const panel = this.add.graphics().setDepth(51)
    panel.fillStyle(0x0a1e40, 1)
    panel.fillRoundedRect(panelX, panelY, panelW, panelH, 16)
    panel.lineStyle(2, 0x4488cc, 1)
    panel.strokeRoundedRect(panelX, panelY, panelW, panelH, 16)
    panel.fillStyle(0x1a3a70, 1)
    panel.fillRoundedRect(panelX, panelY, panelW, panelH * 0.3, 16)
    panel.fillStyle(0x1a3a70, 1)
    panel.fillRect(panelX, panelY + panelH * 0.2, panelW, panelH * 0.1)

    const fs = Math.min(w * 0.058, 31)
    this.add
      .text(w / 2, panelY + 30, 'DESTINATION REACHED!', {
        fontSize: `${fs}px`,
        fontFamily: 'Georgia, serif',
        color: '#e8f4ff',
        stroke: '#000033',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setDepth(52)

    this.add
      .text(w / 2, panelY + panelH * 0.38, 'TIME', {
        fontSize: `${Math.floor(fs * 0.56)}px`,
        fontFamily: 'Arial, sans-serif',
        color: '#88aacc',
      })
      .setOrigin(0.5)
      .setDepth(52)

    this.add
      .text(w / 2, panelY + panelH * 0.5, `${this.finalTimeSec.toFixed(1)}s`, {
        fontSize: `${Math.floor(fs * 1.3)}px`,
        fontFamily: 'Georgia, serif',
        color: '#44ddff',
        stroke: '#001133',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(52)

    const bestLabel =
      this.bestTimeSec === null ? 'BEST: --' : `BEST: ${this.bestTimeSec.toFixed(1)}s`
    this.add
      .text(w / 2, panelY + panelH * 0.64, bestLabel, {
        fontSize: `${Math.floor(fs * 0.64)}px`,
        fontFamily: 'Arial, sans-serif',
        color: '#c2e6ff',
      })
      .setOrigin(0.5)
      .setDepth(52)

    if (this.isNewRecord) {
      this.add
        .text(w / 2, panelY + panelH * 0.7, 'NEW RECORD!', {
          fontSize: `${Math.floor(fs * 0.66)}px`,
          fontFamily: 'Georgia, serif',
          color: '#ffdd44',
        })
        .setOrigin(0.5)
        .setDepth(52)
    }

    const btnW = Math.min(panelW * 0.82, 280)
    const btnH = 46
    const btnGap = 10
    const btnX = w / 2 - btnW / 2
    const btn2Y = panelY + panelH - btnH - 22
    const btn1Y = btn2Y - btnH - btnGap

    const wireEndPanelButton = (
      label: string,
      btnY: number,
      onPress: () => void
    ): void => {
      const btnBg = this.add.graphics().setDepth(52)
      this.drawPanelButton(btnBg, btnX, btnY, btnW, btnH, false)
      this.add
        .text(w / 2, btnY + btnH / 2, label, {
          fontSize: `${Math.floor(fs * 0.68)}px`,
          fontFamily: 'Georgia, serif',
          color: '#ffffff',
          stroke: '#002255',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(53)

      const btnZone = this.add
        .zone(w / 2, btnY + btnH / 2, btnW + 20, btnH + 20)
        .setInteractive()
        .setDepth(54)

      btnZone.on('pointerover', () => this.drawPanelButton(btnBg, btnX, btnY, btnW, btnH, true))
      btnZone.on('pointerout', () => this.drawPanelButton(btnBg, btnX, btnY, btnW, btnH, false))
      btnZone.on('pointerdown', onPress)
    }

    wireEndPanelButton('NEW RANDOM MAP', btn1Y, () => {
      this.registry.set('routeMapOverride', generateRandomRouteMap())
      this.scene.restart()
    })
    wireEndPanelButton('SAIL AGAIN (SAME MAP)', btn2Y, () => {
      this.registry.set('routeMapOverride', this.routeMap)
      this.scene.restart()
    })
  }

  private getBestTimeStorageKey(): string {
    return `kisswind-best-time-${this.routeMap.id}`
  }

  private loadBestTime(): number | null {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(this.getBestTimeStorageKey())
    if (!raw) return null
    const v = Number.parseFloat(raw)
    return Number.isFinite(v) && v > 0 ? v : null
  }

  private saveBestTime(sec: number): void {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(this.getBestTimeStorageKey(), sec.toFixed(3))
  }

  private drawPanelButton(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    hovered: boolean
  ): void {
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
    const { sailCy } = this.getHudLayout()

    if (this.countdownText) {
      const fontPx = Math.round(Math.min(w, h) * 0.28)
      this.countdownText.setPosition(w / 2, h / 2)
      this.countdownText.setFontSize(`${fontPx}px`)
      this.countdownText.setStroke(`#001a33`, Math.max(6, Math.round(fontPx * 0.08)))
    }

    if (this.scoreText) this.scoreText.setPosition(w - 16, 16)
    if (this.windText) this.windText.setPosition(w / 2, 82)
    if (this.speedGaugeText) this.speedGaugeText.setPosition(w / 2, sailCy)

    if (this.zoomMinusZone && this.zoomPlusZone) {
      this.zoomMinusZone.destroy()
      this.zoomPlusZone.destroy()
      this.zoomMinusGfx.destroy()
      this.zoomPlusGfx.destroy()
      this.zoomMinusLabel.destroy()
      this.zoomPlusLabel.destroy()
      this.createZoomControls()
    }

    if (this.world) this.world.resize(this.physState.posX, this.physState.posY)
  }

  shutdown(): void {
    if (this.countdownText) this.countdownText.destroy()
    this.scale.off('resize', this.onResize, this)
    this.input.off('pointerdown', this.onPointerDown, this)
    this.input.off('pointermove', this.onPointerMove, this)
    this.input.off('pointerup', this.onPointerUp, this)
    this.input.off('pointerupoutside', this.onPointerUp, this)
    this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onPointerWheel, this)
    if (this.ambient) this.ambient.destroy()
    if (this.boat) this.boat.destroy()
    if (this.seaLife) this.seaLife.destroy()
    if (this.world) this.world.destroy()
  }
}

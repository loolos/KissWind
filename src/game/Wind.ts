import { MAP_ZOOM, viewportHalfExtents } from './mapConfig'
import { normalizeAngle } from './Physics'

/** World-space distances are divided by MAP_ZOOM so screen appearance matches pre-zoom behavior. */
const Z = MAP_ZOOM

/** Base wind strength level vs previous default (~1.0). */
const BASE_WIND_STRENGTH_MULT = 1.5
/** Wind direction angular change vs previous (applied to d(direction)/dt). */
const WIND_DIRECTION_CHANGE_MULT = 0.3

/** Wind zone radius vs base (80–200 world-units before Z): random 1.5×–2×. */
const ZONE_RADIUS_MULT_MIN = 1.5
const ZONE_RADIUS_MULT_MAX = 2

/**
 * Max zone radius in world units (for spawn distance / culling).
 * Matches (200/Z) * ZONE_RADIUS_MULT_MAX.
 */
function maxZoneRadiusWorld(): number {
  return (200 / Z) * ZONE_RADIUS_MULT_MAX
}

/** Drop zones farther than this from the boat (must exceed max off-screen spawn distance). */
const ZONE_KEEP_DISTANCE = 5200 / Z

/** Replenish toward this many zones (each timer tick adds up to SPAWN_PER_TICK). */
const ZONE_TARGET_MAX = 12
/** Initial zones placed at game start. */
const INITIAL_ZONE_COUNT = 6
const SPAWN_PER_TICK = 2

/**
 * ~50% spawns use this nearer band (still mostly off-screen but reachable);
 * rest use the farther band so you still sail into large gusts.
 */
const NEAR_SPAWN_FRAC = 0.5

export interface WindZone {
  worldX: number
  worldY: number
  radius: number
  type: 'gust' | 'dead'
  multiplier: number
}

export class Wind {
  direction: number       // radians, direction wind blows TOWARD
  strength: number        // base strength
  private driftRate: number
  private driftTimer: number
  private driftDuration: number
  private targetDrift: number

  zones: WindZone[]
  private zoneTimer: number
  private zoneDuration: number

  constructor() {
    this.direction = Math.random() * Math.PI * 2
    this.strength = 1.0 * BASE_WIND_STRENGTH_MULT
    this.driftRate = 0
    this.driftTimer = 0
    this.driftDuration = this.randomDriftDuration()
    this.targetDrift = this.randomDrift()
    this.zones = []
    this.zoneTimer = 0
    this.zoneDuration = 5
  }

  private randomDriftDuration(): number {
    return 5 + Math.random() * 5
  }

  private randomDrift(): number {
    return (Math.random() - 0.5) * 0.4  // ±0.2 rad/s
  }

  /** Call from GameScene after viewport size is known (e.g. create). */
  spawnInitialZones(viewW: number, viewH: number, centerX = 0, centerY = 0): void {
    const viewport = viewportHalfExtents(viewW, viewH, MAP_ZOOM)
    for (let i = 0; i < INITIAL_ZONE_COUNT; i++) {
      this.spawnZone(centerX, centerY, viewport)
    }
  }

  spawnZone(
    centerX = 0,
    centerY = 0,
    viewport?: { halfW: number; halfH: number }
  ): void {
    const angle = Math.random() * Math.PI * 2
    const radiusMult = ZONE_RADIUS_MULT_MIN + Math.random() * (ZONE_RADIUS_MULT_MAX - ZONE_RADIUS_MULT_MIN)
    const radius = ((80 + Math.random() * 120) / Z) * radiusMult

    let dist: number
    if (viewport) {
      const diag = Math.sqrt(viewport.halfW * viewport.halfW + viewport.halfH * viewport.halfH)
      const rMax = maxZoneRadiusWorld()
      const margin = 120 / Z
      if (Math.random() < NEAR_SPAWN_FRAC) {
        // Closer ring: easier to intersect while playing; inner edge can graze the view.
        const distMinNear = diag + 30 / Z + Math.random() * (40 / Z)
        const distRangeNear = (400 + Math.random() * 500) / Z
        dist = distMinNear + Math.random() * distRangeNear
      } else {
        const distMinFar = diag + rMax + margin
        const distRangeFar = (700 + Math.random() * 600) / Z
        dist = distMinFar + Math.random() * distRangeFar
      }
    } else {
      dist = (300 + Math.random() * 600) / Z
    }

    const type = Math.random() < 0.6 ? 'gust' : 'dead'
    this.zones.push({
      worldX: centerX + Math.cos(angle) * dist,
      worldY: centerY + Math.sin(angle) * dist,
      radius,
      type,
      multiplier: type === 'gust' ? 1.5 : 0.3,
    })
  }

  update(
    dt: number,
    boatWorldX: number,
    boatWorldY: number,
    viewW?: number,
    viewH?: number
  ): void {
    // Wind direction drift
    this.driftTimer += dt
    if (this.driftTimer >= this.driftDuration) {
      this.driftTimer = 0
      this.driftDuration = this.randomDriftDuration()
      this.targetDrift = this.randomDrift()
    }

    // Smoothly interpolate drift rate
    this.driftRate += (this.targetDrift - this.driftRate) * dt * 0.5
    this.direction = normalizeAngle(
      this.direction + this.driftRate * dt * WIND_DIRECTION_CHANGE_MULT
    )

    // Slowly vary strength
    const strengthTarget =
      (0.8 + Math.sin(this.driftTimer * 0.3) * 0.4) * BASE_WIND_STRENGTH_MULT
    this.strength += (strengthTarget - this.strength) * dt * 0.1
    this.strength = Math.max(
      0.5 * BASE_WIND_STRENGTH_MULT,
      Math.min(2.0 * BASE_WIND_STRENGTH_MULT, this.strength)
    )

    // Spawn/remove zones
    this.zoneTimer += dt
    if (this.zoneTimer >= this.zoneDuration) {
      this.zoneTimer = 0
      this.zoneDuration = 3 + Math.random() * 5
      // Remove old zones far away
      this.zones = this.zones.filter(z => {
        const dx = z.worldX - boatWorldX
        const dy = z.worldY - boatWorldY
        return Math.sqrt(dx * dx + dy * dy) < ZONE_KEEP_DISTANCE
      })
      const viewport =
        viewW !== undefined && viewH !== undefined
          ? viewportHalfExtents(viewW, viewH, MAP_ZOOM)
          : undefined
      let n = 0
      while (this.zones.length < ZONE_TARGET_MAX && n < SPAWN_PER_TICK) {
        this.spawnZone(boatWorldX, boatWorldY, viewport)
        n++
      }
    }
  }

  /**
   * Get effective wind strength at a world position, accounting for zones.
   */
  getStrengthAt(worldX: number, worldY: number): number {
    let s = this.strength
    for (const zone of this.zones) {
      const dx = worldX - zone.worldX
      const dy = worldY - zone.worldY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < zone.radius) {
        const blend = 1 - dist / zone.radius
        s = s * (1 - blend) + s * zone.multiplier * blend
      }
    }
    return Math.max(0.1, s)
  }
}

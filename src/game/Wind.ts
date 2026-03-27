import { MAP_ZOOM } from './mapConfig'
import { normalizeAngle } from './Physics'

/** World-space distances are divided by MAP_ZOOM so screen appearance matches pre-zoom behavior. */
const Z = MAP_ZOOM

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
    this.strength = 1.0
    this.driftRate = 0
    this.driftTimer = 0
    this.driftDuration = this.randomDriftDuration()
    this.targetDrift = this.randomDrift()
    this.zones = []
    this.zoneTimer = 0
    this.zoneDuration = 8
    this.spawnInitialZones()
  }

  private randomDriftDuration(): number {
    return 5 + Math.random() * 5
  }

  private randomDrift(): number {
    return (Math.random() - 0.5) * 0.4  // ±0.2 rad/s
  }

  private spawnInitialZones(): void {
    for (let i = 0; i < 3; i++) {
      this.spawnZone()
    }
  }

  spawnZone(centerX = 0, centerY = 0): void {
    const angle = Math.random() * Math.PI * 2
    const dist = (300 + Math.random() * 600) / Z
    const type = Math.random() < 0.6 ? 'gust' : 'dead'
    this.zones.push({
      worldX: centerX + Math.cos(angle) * dist,
      worldY: centerY + Math.sin(angle) * dist,
      radius: (80 + Math.random() * 120) / Z,
      type,
      multiplier: type === 'gust' ? 1.5 : 0.3,
    })
  }

  update(dt: number, boatWorldX: number, boatWorldY: number): void {
    // Wind direction drift
    this.driftTimer += dt
    if (this.driftTimer >= this.driftDuration) {
      this.driftTimer = 0
      this.driftDuration = this.randomDriftDuration()
      this.targetDrift = this.randomDrift()
    }

    // Smoothly interpolate drift rate
    this.driftRate += (this.targetDrift - this.driftRate) * dt * 0.5
    this.direction = normalizeAngle(this.direction + this.driftRate * dt)

    // Slowly vary strength
    const strengthTarget = 0.8 + Math.sin(this.driftTimer * 0.3) * 0.4
    this.strength += (strengthTarget - this.strength) * dt * 0.1
    this.strength = Math.max(0.5, Math.min(2.0, this.strength))

    // Spawn/remove zones
    this.zoneTimer += dt
    if (this.zoneTimer >= this.zoneDuration) {
      this.zoneTimer = 0
      this.zoneDuration = 6 + Math.random() * 6
      // Remove old zones far away
      this.zones = this.zones.filter(z => {
        const dx = z.worldX - boatWorldX
        const dy = z.worldY - boatWorldY
        return Math.sqrt(dx * dx + dy * dy) < 1200 / Z
      })
      // Keep 2-5 zones
      if (this.zones.length < 5) {
        this.spawnZone(boatWorldX, boatWorldY)
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

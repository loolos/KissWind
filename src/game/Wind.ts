import { MAP_ZOOM_BASE, viewportHalfExtents } from './mapConfig'
import { normalizeAngle } from './Physics'
import {
  FIXED_ROUTE_MAP,
  FixedRouteMap,
  sampleMapWindAtWithAnchors,
  windAnchorsWithinReach,
  type WindAnchorPoint,
} from './fixedMap'

/**
 * Base wind strength (global scale). `Wind.strength` and its oscillation band are built from this;
 * gust / dead zones apply fixed coefficients to the current `strength` (see `getStrengthAt`).
 */
export const BASE_WIND = 3

/**
 * Zone radius in pre-zoom units: (base / mapZoom) * radiusMult = world radius.
 * Larger bases + mults = visibly bigger gust / dead patches on the map.
 */
const ZONE_RADIUS_BASE_MIN = 140
const ZONE_RADIUS_BASE_MAX = 320
const ZONE_RADIUS_MULT_MIN = 2.0
const ZONE_RADIUS_MULT_MAX = 2.75

/** 0 at edge, 1 at center: smooth C¹ fade for wind strength inside the disc. */
function zoneRadialInfluence(dist: number, radius: number): number {
  if (dist >= radius || radius <= 0) return 0
  const u = 1 - dist / radius
  const t = u <= 0 ? 0 : u >= 1 ? 1 : u
  return t * t * (3 - 2 * t)
}


/** Replenish toward this many zones (each timer tick adds up to SPAWN_PER_TICK). */
const ZONE_TARGET_MAX = 16
/** Initial zones placed at game start. */
const INITIAL_ZONE_COUNT = 8
const SPAWN_PER_TICK = 4

/** Fraction of spawns biased toward boat heading (rest: full circle). */
const SPAWN_FORWARD_BIAS = 0.72
/** Half-width of forward cone (rad): ±π/2 = semicircle ahead of velocity. */
const SPAWN_FORWARD_HALF_WIDTH = Math.PI / 2

/** Gust zone: at disc center, effective strength → `strength` × this (coefficient on base wind). */
const GUST_ZONE_MULTIPLIER = 3.0

/**
 * ~50% spawns use this nearer band (still mostly off-screen but reachable);
 * rest use the farther band so you still sail into large gusts.
 */
const NEAR_SPAWN_FRAC = 0.5

/** How often to recompute which anchors are in range (seconds). */
const WIND_ANCHOR_SCAN_INTERVAL = 2

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
  /** Matches map projection / World.mapZoom for spawn radii and distances. */
  mapZoom: number = MAP_ZOOM_BASE
  private readonly fixedMap: FixedRouteMap
  private elapsedSec: number

  zones: WindZone[]
  private zoneTimer: number
  private zoneDuration: number

  /** Refreshed every `WIND_ANCHOR_SCAN_INTERVAL` s at boat position; sampling only blends these. */
  private windActiveAnchors: WindAnchorPoint[] = []
  private anchorScanAccum = 0

  constructor(fixedMap: FixedRouteMap = FIXED_ROUTE_MAP) {
    this.fixedMap = fixedMap
    this.windActiveAnchors = windAnchorsWithinReach(
      fixedMap,
      fixedMap.start.worldX,
      fixedMap.start.worldY
    )
    const startWind = sampleMapWindAtWithAnchors(
      fixedMap,
      fixedMap.start.worldX,
      fixedMap.start.worldY,
      0,
      this.windActiveAnchors
    )
    this.direction = startWind.direction
    this.strength = startWind.strength
    this.elapsedSec = 0
    this.zones = []
    this.zoneTimer = 0
    this.zoneDuration = 5
  }

  private maxZoneRadiusWorld(): number {
    return (ZONE_RADIUS_BASE_MAX / this.mapZoom) * ZONE_RADIUS_MULT_MAX
  }

  private zoneKeepDistance(): number {
    return 5200 / this.mapZoom
  }

  setMapZoom(z: number): void {
    this.mapZoom = z
  }

  /** Call from GameScene after viewport size is known (e.g. create). */
  spawnInitialZones(
    viewW: number,
    viewH: number,
    centerX = 0,
    centerY = 0,
    boatHeading?: number
  ): void {
    const viewport = viewportHalfExtents(viewW, viewH, this.mapZoom)
    for (let i = 0; i < INITIAL_ZONE_COUNT; i++) {
      this.spawnZone(centerX, centerY, viewport, boatHeading)
    }
  }

  private sampleSpawnAngle(boatHeading?: number): number {
    if (boatHeading === undefined) {
      return Math.random() * Math.PI * 2
    }
    if (Math.random() < SPAWN_FORWARD_BIAS) {
      return normalizeAngle(
        boatHeading + (Math.random() - 0.5) * 2 * SPAWN_FORWARD_HALF_WIDTH
      )
    }
    return Math.random() * Math.PI * 2
  }

  spawnZone(
    centerX = 0,
    centerY = 0,
    viewport?: { halfW: number; halfH: number },
    boatHeading?: number
  ): void {
    const angle = this.sampleSpawnAngle(viewport !== undefined ? boatHeading : undefined)
    const z = this.mapZoom
    const radiusMult = ZONE_RADIUS_MULT_MIN + Math.random() * (ZONE_RADIUS_MULT_MAX - ZONE_RADIUS_MULT_MIN)
    const base =
      ZONE_RADIUS_BASE_MIN +
      Math.random() * (ZONE_RADIUS_BASE_MAX - ZONE_RADIUS_BASE_MIN)
    const radius = (base / z) * radiusMult

    let dist: number
    if (viewport) {
      const diag = Math.sqrt(viewport.halfW * viewport.halfW + viewport.halfH * viewport.halfH)
      const rMax = this.maxZoneRadiusWorld()
      const margin = 120 / z
      if (Math.random() < NEAR_SPAWN_FRAC) {
        // Closer ring: easier to intersect while playing; inner edge can graze the view.
        const distMinNear = diag + 30 / z + Math.random() * (40 / z)
        const distRangeNear = (400 + Math.random() * 500) / z
        dist = distMinNear + Math.random() * distRangeNear
      } else {
        const distMinFar = diag + rMax + margin
        const distRangeFar = (700 + Math.random() * 600) / z
        dist = distMinFar + Math.random() * distRangeFar
      }
    } else {
      dist = (300 + Math.random() * 600) / z
    }

    const type = Math.random() < 0.6 ? 'gust' : 'dead'
    this.zones.push({
      worldX: centerX + Math.cos(angle) * dist,
      worldY: centerY + Math.sin(angle) * dist,
      radius,
      type,
      multiplier: type === 'gust' ? GUST_ZONE_MULTIPLIER : 0.3,
    })
  }

  update(
    dt: number,
    boatWorldX: number,
    boatWorldY: number,
    viewW?: number,
    viewH?: number,
    boatHeading?: number
  ): void {
    this.elapsedSec += dt
    this.anchorScanAccum += dt
    if (this.anchorScanAccum >= WIND_ANCHOR_SCAN_INTERVAL) {
      this.anchorScanAccum -= WIND_ANCHOR_SCAN_INTERVAL
      this.windActiveAnchors = windAnchorsWithinReach(this.fixedMap, boatWorldX, boatWorldY)
    }

    const baseWind = sampleMapWindAtWithAnchors(
      this.fixedMap,
      boatWorldX,
      boatWorldY,
      this.elapsedSec,
      this.windActiveAnchors
    )
    const dirDelta = normalizeAngle(baseWind.direction - this.direction)
    this.direction = normalizeAngle(this.direction + dirDelta * Math.min(1, dt * 3.2))
    this.strength += (baseWind.strength - this.strength) * Math.min(1, dt * 2.4)
    this.strength = Math.max(0.4, this.strength)

    // Spawn/remove zones
    this.zoneTimer += dt
    if (this.zoneTimer >= this.zoneDuration) {
      this.zoneTimer = 0
      this.zoneDuration = 1.2 + Math.random() * 2.2
      // Remove old zones far away
      const keepDist = this.zoneKeepDistance()
      this.zones = this.zones.filter(zone => {
        const dx = zone.worldX - boatWorldX
        const dy = zone.worldY - boatWorldY
        return Math.sqrt(dx * dx + dy * dy) < keepDist
      })
      const viewport =
        viewW !== undefined && viewH !== undefined
          ? viewportHalfExtents(viewW, viewH, this.mapZoom)
          : undefined
      let n = 0
      while (this.zones.length < ZONE_TARGET_MAX && n < SPAWN_PER_TICK) {
        this.spawnZone(boatWorldX, boatWorldY, viewport, boatHeading)
        n++
      }
    }
  }

  /**
   * Get effective wind at a world position:
   * - fixed-map interpolated large-scale wind
   * - plus random gust/dead zone multipliers
   */
  getWindAt(worldX: number, worldY: number): { direction: number; strength: number } {
    const base = sampleMapWindAtWithAnchors(
      this.fixedMap,
      worldX,
      worldY,
      this.elapsedSec,
      this.windActiveAnchors
    )
    let s = base.strength
    for (const zone of this.zones) {
      const dx = worldX - zone.worldX
      const dy = worldY - zone.worldY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const w = zoneRadialInfluence(dist, zone.radius)
      if (w > 0) {
        s = s * (1 - w) + s * zone.multiplier * w
      }
    }
    return {
      direction: base.direction,
      strength: Math.max(0.1, s),
    }
  }

  getStrengthAt(worldX: number, worldY: number): number {
    return this.getWindAt(worldX, worldY).strength
  }
}

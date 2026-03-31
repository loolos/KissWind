import { MAP_ZOOM_BASE, viewportHalfExtents } from './mapConfig'
import { getMinimapEdgeWorldRef } from './minimapLayout'
import { normalizeAngle } from './Physics'
import {
  FIXED_ROUTE_MAP,
  FixedRouteMap,
  applyWindWaves,
  getFixedMapBounds,
  sampleMapWindAtWithAnchors,
  windAnchorsWithinReach,
  type FixedMapBounds,
  type WindAnchorPoint,
} from './fixedMap'
import { isPointOnAnyLand } from './land'

/** Padding for bounds used in homing logic; must match `GameScene` minimap `getFixedMapBounds(..., 56)`. */
const MAP_BOUNDS_PADDING = 56

/**
 * `u = overrun / (homingRefSpan * this)` for boundary homing. Larger = wider world-space blend
 * before wind is fully finish-directed (same 0–0.1 `u` curve, stretched in distance).
 */
const BOUNDARY_HOMING_REF_SCALE = 3

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

/** Gust zone: at disc center, effective strength → `strength` × this (coefficient on base wind). */
const GUST_ZONE_MULTIPLIER = 3.0

/** How often to recompute which anchors are in range (seconds). */
const WIND_ANCHOR_SCAN_INTERVAL = 2

/** Euclidean distance from `(x,y)` to the axis-aligned rect; 0 if inside or on the edge. */
function distanceOutsideBounds(x: number, y: number, b: FixedMapBounds): number {
  const ox = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0
  const oy = y < b.minY ? b.minY - y : y > b.maxY ? y - b.maxY : 0
  if (ox === 0 && oy === 0) return 0
  if (ox === 0) return oy
  if (oy === 0) return ox
  return Math.hypot(ox, oy)
}

/** At u=0.1⁻, virtual finish anchor outweighs map by this factor (same form as multi-anchor vector sum). */
const FINISH_ANCHOR_TAIL_DOMINANCE = 99

/**
 * Weight of the virtual “finish” anchor. u = overrun / (homingRefSpan * BOUNDARY_HOMING_REF_SCALE).
 * At u=5% equals `wMap` so map leg and finish leg match (same rule as Σ cos(dir)·w per anchor).
 */
function finishAnchorInfluenceWeight(u: number, wMap: number): number {
  if (u <= 0) return 0
  if (u <= 0.05) return wMap * (u / 0.05)
  const t = (u - 0.05) / 0.05
  return wMap * (1 + FINISH_ANCHOR_TAIL_DOMINANCE * t)
}

export interface WindZone {
  worldX: number
  worldY: number
  radius: number
  type: 'gust' | 'dead'
  multiplier: number
  routeProgress: number
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
  private readonly routeStartX: number
  private readonly routeStartY: number
  private readonly routeDirX: number
  private readonly routeDirY: number
  private readonly routePerpX: number
  private readonly routePerpY: number
  private readonly routeLength: number

  /** Refreshed every `WIND_ANCHOR_SCAN_INTERVAL` s at boat position; sampling only blends these. */
  private windActiveAnchors: WindAnchorPoint[] = []
  private anchorScanAccum = 0
  /** World rect matching the minimap; outside it, wind gradually biases toward the finish. */
  private readonly mapBounds: FixedMapBounds
  /** World length ≈ shorter minimap inner edge; updated via `setMinimapHomingRefFromViewport`. */
  private homingRefSpan: number

  constructor(fixedMap: FixedRouteMap = FIXED_ROUTE_MAP) {
    this.fixedMap = fixedMap
    this.mapBounds = getFixedMapBounds(fixedMap, MAP_BOUNDS_PADDING)
    this.homingRefSpan = Math.min(this.mapBounds.width, this.mapBounds.height)
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
    const sx = fixedMap.start.worldX
    const sy = fixedMap.start.worldY
    const fx = fixedMap.finish.worldX
    const fy = fixedMap.finish.worldY
    const dx = fx - sx
    const dy = fy - sy
    const len = Math.hypot(dx, dy)
    this.routeLength = Math.max(1, len)
    this.routeDirX = dx / this.routeLength
    this.routeDirY = dy / this.routeLength
    this.routePerpX = -this.routeDirY
    this.routePerpY = this.routeDirX
    this.routeStartX = sx
    this.routeStartY = sy
  }

  private zoneKeepDistance(): number {
    return 5200 / this.mapZoom
  }

  setMapZoom(z: number): void {
    this.mapZoom = z
  }

  /** Call each frame (or when viewport changes) so boundary homing `u` uses minimap edge length in world units. */
  setMinimapHomingRefFromViewport(viewW: number, viewH: number): void {
    this.homingRefSpan = Math.max(
      1,
      getMinimapEdgeWorldRef(viewW, viewH, this.mapBounds)
    )
  }

  /**
   * Outside `mapBounds`, add a virtual anchor (wind toward finish) with the same vector-sum rule
   * as real anchors. Until overrun ≥ 10% of scaled ref (`homingRefSpan * BOUNDARY_HOMING_REF_SCALE`),
   * map sample and finish anchor both contribute; beyond that, only the finish anchor
   * (then `applyWindWaves` like the rest of the map).
   */
  private applyBoundaryHoming(
    mapDirection: number,
    mapStrength: number,
    worldX: number,
    worldY: number
  ): number {
    const overrun = distanceOutsideBounds(worldX, worldY, this.mapBounds)
    if (overrun <= 0) return mapDirection

    const { worldX: fx, worldY: fy } = this.fixedMap.finish
    const dx = fx - worldX
    const dy = fy - worldY
    if (dx * dx + dy * dy < 1e-8) return mapDirection
    const towardFinish = Math.atan2(dy, dx)

    const u = overrun / (this.homingRefSpan * BOUNDARY_HOMING_REF_SCALE)
    const wMap = Math.max(0.4, mapStrength)

    if (u >= 0.1) {
      return applyWindWaves(
        worldX,
        worldY,
        this.elapsedSec,
        towardFinish,
        mapStrength
      ).direction
    }

    const wFin = finishAnchorInfluenceWeight(u, wMap)
    const cx = Math.cos(mapDirection) * wMap + Math.cos(towardFinish) * wFin
    const sy = Math.sin(mapDirection) * wMap + Math.sin(towardFinish) * wFin
    return Math.atan2(sy, cx)
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

  private routeProgressAt(worldX: number, worldY: number): number {
    const relX = worldX - this.routeStartX
    const relY = worldY - this.routeStartY
    const t = (relX * this.routeDirX + relY * this.routeDirY) / this.routeLength
    return Math.max(0, Math.min(1, t))
  }

  private sampleSpawnProgress(boatProgress: number): number {
    const windowStart = Math.max(0, boatProgress - 0.12)
    const windowEnd = Math.min(1, boatProgress + 0.88)
    const binCount = 8
    const counts = new Array<number>(binCount).fill(0)
    for (const zone of this.zones) {
      if (zone.routeProgress < windowStart || zone.routeProgress > windowEnd) continue
      const span = Math.max(1e-6, windowEnd - windowStart)
      const u = (zone.routeProgress - windowStart) / span
      const idx = Math.max(0, Math.min(binCount - 1, Math.floor(u * binCount)))
      counts[idx]++
    }
    let minCount = counts[0]
    for (let i = 1; i < counts.length; i++) minCount = Math.min(minCount, counts[i])
    const candidates: number[] = []
    for (let i = 0; i < counts.length; i++) if (counts[i] === minCount) candidates.push(i)
    const chosen = candidates[Math.floor(Math.random() * candidates.length)]
    const span = Math.max(1e-6, windowEnd - windowStart)
    const binW = span / binCount
    const jitter = 0.15 + Math.random() * 0.7
    return Math.max(0, Math.min(1, windowStart + (chosen + jitter) * binW))
  }

  private isZoneOverlapping(worldX: number, worldY: number, radius: number): boolean {
    const minGap = 80 / this.mapZoom
    for (const zone of this.zones) {
      const dx = worldX - zone.worldX
      const dy = worldY - zone.worldY
      const minDist = (zone.radius + radius) * 0.75 + minGap
      if (dx * dx + dy * dy < minDist * minDist) return true
    }
    return false
  }

  spawnZone(
    centerX = 0,
    centerY = 0,
    viewport?: { halfW: number; halfH: number },
    boatHeading?: number
  ): void {
    for (let attempt = 0; attempt < 18; attempt++) {
      const z = this.mapZoom
      const radiusMult =
        ZONE_RADIUS_MULT_MIN + Math.random() * (ZONE_RADIUS_MULT_MAX - ZONE_RADIUS_MULT_MIN)
      const base =
        ZONE_RADIUS_BASE_MIN +
        Math.random() * (ZONE_RADIUS_BASE_MAX - ZONE_RADIUS_BASE_MIN)
      const radius = (base / z) * radiusMult

      const boatProgress = this.routeProgressAt(centerX, centerY)
      const routeProgress = this.sampleSpawnProgress(boatProgress)
      const routeDist = routeProgress * this.routeLength
      const corridorHalfWidth = 960 / z
      const lateralOffset = (Math.random() - 0.5) * 2 * corridorHalfWidth
      const jitterScale = viewport ? 220 / z : 140 / z
      const jitterX = (Math.random() - 0.5) * 2 * jitterScale
      const jitterY = (Math.random() - 0.5) * 2 * jitterScale
      const worldX =
        this.routeStartX +
        this.routeDirX * routeDist +
        this.routePerpX * lateralOffset +
        jitterX
      const worldY =
        this.routeStartY +
        this.routeDirY * routeDist +
        this.routePerpY * lateralOffset +
        jitterY
      // Keep local wind zones completely away from land masses.
      if (isPointOnAnyLand(this.fixedMap.lands, worldX, worldY, radius + 6)) continue
      if (this.isZoneOverlapping(worldX, worldY, radius)) continue

      const type = Math.random() < 0.6 ? 'gust' : 'dead'
      this.zones.push({
        worldX,
        worldY,
        radius,
        type,
        multiplier: type === 'gust' ? GUST_ZONE_MULTIPLIER : 0.3,
        routeProgress,
      })
      return
    }
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
    const targetDir = this.applyBoundaryHoming(
      baseWind.direction,
      baseWind.strength,
      boatWorldX,
      boatWorldY
    )
    const dirDelta = normalizeAngle(targetDir - this.direction)
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
    // Use smoothed direction from `update()` (toward `applyBoundaryHoming` target). Returning
    // instant homing here made wind at the boat snap when crossing `mapBounds` while HUD/physics
    // ignored the eased `this.direction`.
    const direction = this.direction
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
      direction,
      strength: Math.max(0.1, s),
    }
  }

  getStrengthAt(worldX: number, worldY: number): number {
    return this.getWindAt(worldX, worldY).strength
  }
}

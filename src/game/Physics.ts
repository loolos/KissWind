// Physics constants
export const K1 = 0.05  // linear drag coefficient
export const K2 = 0.015 // quadratic drag coefficient

// Sail angle zones (relative to wind): green = 45° total centered on optimal; ±45° beyond that = yellow
// per side; outside = gray (low thrust).
export const OPTIMAL_ANGLE = Math.PI * 0.6  // ~110 deg from wind direction (beam/close reach)
/** Half-width of green zone from optimal (total green span = 2 × this = 45°) */
export const GREEN_ZONE_HALF_WIDTH = Math.PI / 8
/** Outer edge of yellow zone from optimal (half-width of green + 45° per side) */
export const YELLOW_ZONE_OUTER_HALF_WIDTH = GREEN_ZONE_HALF_WIDTH + Math.PI / 4

export interface PhysicsState {
  posX: number
  posY: number
  velX: number
  velY: number
  accX: number
  accY: number
}

export type SailQuality = 'green' | 'yellow' | 'gray'

export interface ThrustResult {
  thrustX: number
  thrustY: number
  thrustMag: number
  quality: SailQuality
  multiplier: number
}

/**
 * Compute sail force vector from wind and sail orientation.
 *
 * sailAngle: the absolute angle of the sail in world space (radians)
 * windDir:   direction the wind is blowing TOWARD (radians)
 * windStrength: scalar wind strength
 */
export function computeThrust(
  sailAngle: number,
  windDir: number,
  windStrength: number
): ThrustResult {
  // Wind vector (direction wind blows toward)
  const windVx = Math.cos(windDir)
  const windVy = Math.sin(windDir)

  // Sail normal (perpendicular to sail)
  const sailNx = Math.cos(sailAngle + Math.PI / 2)
  const sailNy = Math.sin(sailAngle + Math.PI / 2)

  // Signed wind projection on sail normal controls both magnitude and side.
  const windOnNormal = windVx * sailNx + windVy * sailNy
  const windDotSail = Math.abs(windOnNormal)

  // Compute angle between sail and wind to determine sweet spot
  // Sail direction angle
  const sailDir = sailAngle
  // Angle difference between sail and wind direction
  let angleDiff = normalizeAngle(sailDir - windDir)
  // We want |angleDiff| to be around OPTIMAL_ANGLE (beam reach)
  const absAngle = Math.abs(angleDiff)
  // Normalize to 0..PI range
  const relAngle = absAngle > Math.PI ? Math.PI * 2 - absAngle : absAngle

  // Distance from optimal angle
  const distFromOptimal = Math.abs(relAngle - OPTIMAL_ANGLE)

  const multiplier = 1.0
  let quality: SailQuality

  if (distFromOptimal <= GREEN_ZONE_HALF_WIDTH) {
    quality = 'green'
  } else if (distFromOptimal <= YELLOW_ZONE_OUTER_HALF_WIDTH) {
    quality = 'yellow'
  } else {
    quality = 'gray'
  }

  const forceScale = windOnNormal * windStrength * multiplier * 3
  const thrustX = sailNx * forceScale
  const thrustY = sailNy * forceScale
  const thrustMag = Math.sqrt(thrustX * thrustX + thrustY * thrustY)

  return { thrustX, thrustY, thrustMag, quality, multiplier }
}

/**
 * Update physics state for one frame.
 */
export function updatePhysics(
  state: PhysicsState,
  thrustX: number,
  thrustY: number,
  dt: number
): PhysicsState {
  const speed = Math.sqrt(state.velX * state.velX + state.velY * state.velY)

  // Water drag opposes current velocity vector.
  const dragMag = K1 * speed + K2 * speed * speed
  let dragX = 0
  let dragY = 0
  if (speed > 1e-6) {
    dragX = -(state.velX / speed) * dragMag
    dragY = -(state.velY / speed) * dragMag
  }

  const accX = thrustX + dragX
  const accY = thrustY + dragY

  const newVelX = state.velX + accX * dt
  const newVelY = state.velY + accY * dt

  const newPosX = state.posX + newVelX * dt
  const newPosY = state.posY + newVelY * dt

  return {
    posX: newPosX,
    posY: newPosY,
    velX: newVelX,
    velY: newVelY,
    accX,
    accY,
  }
}

export function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2
  while (angle < -Math.PI) angle += Math.PI * 2
  return angle
}

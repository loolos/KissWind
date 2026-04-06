// Physics constants
export const K1 = 0.025 // linear drag coefficient
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

function computeWindBoostSign(
  sailNx: number,
  sailNy: number,
  windOnNormal: number,
  extraWindBoostMagnitude: number,
  boostRefVelX?: number,
  boostRefVelY?: number
): number {
  if (extraWindBoostMagnitude <= 1e-8) return 1
  const projSign = (rx: number, ry: number): number | null => {
    const d = rx * sailNx + ry * sailNy
    if (Math.abs(d) > 1e-6) return Math.sign(d)
    return null
  }
  const windFallback = Math.abs(windOnNormal) > 1e-5 ? Math.sign(windOnNormal) : 1
  const fromVel =
    boostRefVelX !== undefined &&
    boostRefVelY !== undefined &&
    boostRefVelX * boostRefVelX + boostRefVelY * boostRefVelY > 1e-8
  if (fromVel) {
    const sv = projSign(boostRefVelX!, boostRefVelY!)
    return sv !== null ? sv : windFallback
  }
  return windFallback
}

/**
 * Ambient wind vector (direction = where wind blows toward, magnitude = strength)
 * plus boost along sail normal, matching the scalar combined on n̂ in `computeThrust`.
 * Use for HUD wind arrow / readout so boost shifts displayed direction when it applies.
 */
export function effectiveWindVectorForHud(
  sailAngle: number,
  windDir: number,
  windStrength: number,
  extraWindBoostMagnitude: number,
  boostRefVelX?: number,
  boostRefVelY?: number
): { x: number; y: number } {
  const wx = Math.cos(windDir) * windStrength
  const wy = Math.sin(windDir) * windStrength
  if (extraWindBoostMagnitude <= 1e-8) return { x: wx, y: wy }
  const sailNx = Math.cos(sailAngle + Math.PI / 2)
  const sailNy = Math.sin(sailAngle + Math.PI / 2)
  const windVx = Math.cos(windDir)
  const windVy = Math.sin(windDir)
  const windOnNormal = windVx * sailNx + windVy * sailNy
  const boostSign = computeWindBoostSign(
    sailNx,
    sailNy,
    windOnNormal,
    extraWindBoostMagnitude,
    boostRefVelX,
    boostRefVelY
  )
  return {
    x: wx + boostSign * extraWindBoostMagnitude * sailNx,
    y: wy + boostSign * extraWindBoostMagnitude * sailNy,
  }
}

/**
 * Compute sail force vector from wind and sail orientation.
 *
 * sailAngle: the absolute angle of the sail in world space (radians)
 * windDir:   direction the wind is blowing TOWARD (radians)
 * windStrength: scalar wind strength
 * extraWindBoostMagnitude: optional gust along sail normal (same units as wind strength).
 * When > 0, ±n̂ follows the projection sign of `(refVelX,refVelY)` on n̂ (boat velocity vs water);
 * if |v|≈0 or v⊥n̂, falls back to `wind·n̂`.
 */
export function computeThrust(
  sailAngle: number,
  windDir: number,
  windStrength: number,
  extraWindBoostMagnitude: number = 0,
  boostRefVelX?: number,
  boostRefVelY?: number
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

  const boostSign = computeWindBoostSign(
    sailNx,
    sailNy,
    windOnNormal,
    extraWindBoostMagnitude,
    boostRefVelX,
    boostRefVelY
  )

  const forceScale =
    windOnNormal * windStrength * multiplier * 3 + boostSign * extraWindBoostMagnitude * multiplier * 3
  const thrustX = sailNx * forceScale
  const thrustY = sailNy * forceScale
  const thrustMag = Math.sqrt(thrustX * thrustX + thrustY * thrustY)

  return { thrustX, thrustY, thrustMag, quality, multiplier }
}

/**
 * Update physics state for one frame.
 *
 * `state.velX/Y` are velocity **relative to water**. Surface current
 * `(currentX, currentY)` is added only for position integration (ground track).
 */
export function updatePhysics(
  state: PhysicsState,
  thrustX: number,
  thrustY: number,
  dt: number,
  currentX: number,
  currentY: number
): PhysicsState {
  const speed = Math.sqrt(state.velX * state.velX + state.velY * state.velY)

  // Water drag opposes velocity relative to water.
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

  const newPosX = state.posX + (newVelX + currentX) * dt
  const newPosY = state.posY + (newVelY + currentY) * dt

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

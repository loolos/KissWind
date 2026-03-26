// Physics constants
export const K1 = 0.4   // linear drag coefficient
export const K2 = 0.07  // quadratic drag coefficient
export const MAX_SPEED = 6.0
export const TURN_RATE = 0.3  // rad/s auto-steer rate

// Sweet spot angles (relative to wind)
export const OPTIMAL_ANGLE = Math.PI * 0.6  // ~110 deg from wind direction (beam/close reach)
export const SWEET_SPOT_RANGE = Math.PI / 9   // ±20 deg
export const GOOD_RANGE = Math.PI / 4.5       // ±40 deg

export interface PhysicsState {
  speed: number         // scalar speed
  heading: number       // radians, 0 = right (+x)
  posX: number
  posY: number
}

export type SailQuality = 'green' | 'yellow' | 'red'

export interface ThrustResult {
  thrust: number
  quality: SailQuality
  multiplier: number
}

/**
 * Compute the sail thrust given wind direction, sail angle (world space), boat heading, and wind strength.
 *
 * sailAngle: the absolute angle of the sail in world space (radians)
 * windDir:   direction the wind is blowing TOWARD (radians)
 * heading:   boat heading (radians)
 * windStrength: scalar wind strength
 */
export function computeThrust(
  sailAngle: number,
  windDir: number,
  heading: number,
  windStrength: number
): ThrustResult {
  // Wind vector (direction wind blows toward)
  const windVx = Math.cos(windDir)
  const windVy = Math.sin(windDir)

  // Sail normal (perpendicular to sail)
  const sailNx = Math.cos(sailAngle + Math.PI / 2)
  const sailNy = Math.sin(sailAngle + Math.PI / 2)

  // The angle of the sail relative to the wind direction
  // We want the sail to catch wind: dot(wind, sailNormal) drives the sail
  const windDotSail = Math.abs(windVx * sailNx + windVy * sailNy)

  // The thrust projected onto boat heading
  const headVx = Math.cos(heading)
  const headVy = Math.sin(heading)

  // Sail force direction is along the sail's lift (perpendicular to sail)
  // We pick the sign that projects forward
  let liftX = sailNx
  let liftY = sailNy
  if (liftX * headVx + liftY * headVy < 0) {
    liftX = -liftX
    liftY = -liftY
  }

  const forwardComponent = liftX * headVx + liftY * headVy

  // Base thrust from wind-sail interaction
  const baseThrust = windDotSail * forwardComponent * windStrength

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

  let multiplier: number
  let quality: SailQuality

  if (distFromOptimal <= SWEET_SPOT_RANGE) {
    multiplier = 1.5
    quality = 'green'
  } else if (distFromOptimal <= GOOD_RANGE) {
    multiplier = 1.0
    quality = 'yellow'
  } else {
    multiplier = 0.3
    quality = 'red'
  }

  const thrust = Math.max(0, baseThrust * multiplier * 3)

  return { thrust, quality, multiplier }
}

/**
 * Update physics state for one frame.
 */
export function updatePhysics(
  state: PhysicsState,
  thrust: number,
  windDir: number,
  dt: number
): PhysicsState {
  // Auto-steer: boat slowly turns toward the wind direction
  // Ideal heading is roughly into the wind or with the wind (within ±90 deg of wind)
  // We aim to have heading close to windDir (sailing downwind is fastest)
  // But we also let the player influence via sail; for simplicity we auto-steer toward windDir
  const targetHeading = windDir
  let headingDiff = normalizeAngle(targetHeading - state.heading)

  // Clamp turn
  const maxTurn = TURN_RATE * dt
  const turn = Math.sign(headingDiff) * Math.min(Math.abs(headingDiff), maxTurn)
  const newHeading = state.heading + turn

  // Drag
  const v = state.speed
  const drag = -(K1 * v + K2 * v * v)

  // Total acceleration
  const accel = thrust + drag

  // Update speed
  let newSpeed = v + accel * dt
  newSpeed = Math.max(0, Math.min(newSpeed, MAX_SPEED))

  // Update position along heading
  const newPosX = state.posX + Math.cos(newHeading) * newSpeed * dt
  const newPosY = state.posY + Math.sin(newHeading) * newSpeed * dt

  return {
    speed: newSpeed,
    heading: newHeading,
    posX: newPosX,
    posY: newPosY,
  }
}

export function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2
  while (angle < -Math.PI) angle += Math.PI * 2
  return angle
}

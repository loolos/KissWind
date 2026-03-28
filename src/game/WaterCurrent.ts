import { normalizeAngle } from './Physics'

/** Slower than wind so the sea “turns” gently. */
const DIRECTION_DRIFT_MULT = 0.14

/** Base magnitude (world units/s); small but always noticeable. */
const BASE_SPEED = 2.4
const SPEED_MIN = 1.1
const SPEED_MAX = 4.2

/**
 * Large-scale surface current: direction and speed drift slowly.
 * Velocity is (cos(dir), sin(dir)) * speed — direction water flows *toward*.
 */
export class WaterCurrent {
  direction: number
  speed: number

  private driftRate = 0
  private driftTimer = 0
  private driftDuration = 8
  private targetDrift = 0
  private speedOscPhase = Math.random() * Math.PI * 2

  constructor() {
    this.direction = Math.random() * Math.PI * 2
    this.speed = BASE_SPEED
    this.targetDrift = this.randomDrift()
  }

  get velX(): number {
    return Math.cos(this.direction) * this.speed
  }

  get velY(): number {
    return Math.sin(this.direction) * this.speed
  }

  private randomDriftDuration(): number {
    return 10 + Math.random() * 14
  }

  private randomDrift(): number {
    return (Math.random() - 0.5) * 0.022
  }

  update(dt: number): void {
    this.driftTimer += dt
    if (this.driftTimer >= this.driftDuration) {
      this.driftTimer = 0
      this.driftDuration = this.randomDriftDuration()
      this.targetDrift = this.randomDrift()
    }

    this.driftRate += (this.targetDrift - this.driftRate) * dt * 0.35
    this.direction = normalizeAngle(
      this.direction + this.driftRate * dt * DIRECTION_DRIFT_MULT
    )

    this.speedOscPhase += dt * 0.11
    const speedTarget =
      BASE_SPEED + Math.sin(this.speedOscPhase) * 1.1 + Math.sin(this.speedOscPhase * 0.37) * 0.45
    const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, speedTarget))
    this.speed += (clamped - this.speed) * dt * 0.08
  }
}

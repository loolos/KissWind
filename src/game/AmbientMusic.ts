/**
 * Procedural gentle ambient: sparse random pentatonic notes + soft pad.
 * Pad note pool = 5 consecutive rungs on a C-major Do…La ladder (C3 default);
 * every +6 boat speed, window shifts up one rung; tier applies on the same 2–4s tick as note/timbre.
 */

const PENTATONIC_HZ = [
  130.81,  // C3
  146.83,  // D3
  164.81,  // E3
  196.0,   // G3
  220.0,   // A3
]

const NUM_PAD_LAYERS = 1

/** MIDI for C3 — ladder starts here. */
const PAD_LADDER_C3_MIDI = 48

/** Semitone offsets from C for one CDEFGA cycle before the next C. */
const PAD_LADDER_RUNG: readonly number[] = [0, 2, 4, 5, 7, 9]

/** Boat speed units per ladder tier (floor(speed / this) = step). */
const PAD_SPEED_PER_TIER = 6

/** floor(boatSpeed / PAD_SPEED_PER_TIER) clamped to [0, this]. */
const PAD_SPEED_STEP_MAX = 40

function padLadderMidi(index: number): number {
  const q = Math.floor(index / 6)
  const r = index % 6
  return PAD_LADDER_C3_MIDI + q * 12 + PAD_LADDER_RUNG[r]!
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Five pad pitches: ladder rungs [step, step+4] (inclusive), e.g. step 0 → C3…G3, step 1 → D3…A3. */
function padWindowFrequencies(step: number): number[] {
  const s = Math.max(0, Math.min(PAD_SPEED_STEP_MAX, step))
  return [0, 1, 2, 3, 4].map(i => midiToHz(padLadderMidi(s + i)))
}

const MASTER_LEVEL = 0.11
const PAD_LEVEL = 0.14
const NOTE_PEAK = 0.065

/** Glide speed when pad moves toward a new scale degree (higher = faster portamento). */
const PAD_ROOT_SMOOTH_SPEED = 2.2

/** Lowpass cutoff (Hz): darker ↔ brighter pad timbre when combined with wave shape. */
const PAD_FILTER_FREQ_MIN = 120
const PAD_FILTER_FREQ_MAX = 560

/** Soft-ish shapes; sawtooth is mellowed by the lowpass. */
const PAD_WAVESHAPES: OscillatorType[] = ['sine', 'triangle', 'sawtooth']

const PAD_NOTE_SWITCH_MIN_S = 2
const PAD_NOTE_SWITCH_MAX_S = 4
const MELODY_REST_PROBABILITY = 0.42
const MELODY_GAP_MIN_S = 1.4
const MELODY_GAP_MAX_S = 3.8

function pickRandom<T>(arr: readonly T[] | T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

export class AmbientMusic {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private padGain: GainNode | null = null
  private padOscs: OscillatorNode[] = []
  private padFilters: BiquadFilterNode[] = []
  private running = false

  private nextMelodyAt = 0

  /** Pad layer root frequency (Hz): target picks random Do–So; smoothed glides toward it. */
  private padRootTargetHz: number[] = []
  private padRootSmoothedHz: number[] = []
  private nextPadNoteSwitchAt = 0

  /** Ladder step currently used for `padHzPool`. */
  private padPoolStep = 0
  /** Latest step from boat speed; applied on next 2–4s pad tick (with note + timbre). */
  private padPendingPoolStep = 0
  private padHzPool: number[] = padWindowFrequencies(0)

  start(): void {
    if (this.running) return

    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return

    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = MASTER_LEVEL
    this.master.connect(this.ctx.destination)

    this.padGain = this.ctx.createGain()
    this.padGain.gain.value = PAD_LEVEL
    this.padGain.connect(this.master)

    this.padPoolStep = 0
    this.padPendingPoolStep = 0
    this.padHzPool = padWindowFrequencies(0)
    this.padRootTargetHz = []
    this.padRootSmoothedHz = []
    for (let i = 0; i < NUM_PAD_LAYERS; i++) {
      const hz = pickRandom(this.padHzPool)
      this.padRootTargetHz.push(hz)
      this.padRootSmoothedHz.push(hz)
    }

    this.padOscs = []
    this.padFilters = []
    for (let i = 0; i < NUM_PAD_LAYERS; i++) {
      const f = this.padRootSmoothedHz[i]!
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = f

      const filt = this.ctx.createBiquadFilter()
      filt.type = 'lowpass'
      filt.Q.value = 0.78
      filt.frequency.value = 280

      osc.connect(filt)
      filt.connect(this.padGain)
      osc.start()
      this.padOscs.push(osc)
      this.padFilters.push(filt)
    }

    const now = this.ctx.currentTime
    this.nextMelodyAt = now + 1.5 + Math.random() * 2.5
    this.randomizePadTimbre()
    this.nextPadNoteSwitchAt = now + this.nextPadNoteSwitchDelay()
    this.running = true

    void this.ctx.resume()
  }

  /** Call once after a user gesture if audio stayed suspended. */
  resume(): void {
    void this.ctx?.resume()
  }

  /**
   * Records boat-speed tier (step = floor(speed / PAD_SPEED_PER_TIER), +6 speed ≈ one ladder rung).
   * Pool and timbre apply on the 2–4s pad tick, not immediately.
   */
  setBoatSpeed(speed: number): void {
    this.padPendingPoolStep = Math.min(
      PAD_SPEED_STEP_MAX,
      Math.max(0, Math.floor(speed / PAD_SPEED_PER_TIER))
    )
  }

  update(dt: number): void {
    if (!this.running || !this.ctx || !this.master) return

    const now = this.ctx.currentTime

    if (now >= this.nextPadNoteSwitchAt) {
      this.randomizePadNotesAndTimbre()
      this.nextPadNoteSwitchAt = now + this.nextPadNoteSwitchDelay()
    }

    const rootK = Math.min(1, dt * PAD_ROOT_SMOOTH_SPEED)
    for (let i = 0; i < this.padRootSmoothedHz.length; i++) {
      const tgt = this.padRootTargetHz[i]!
      this.padRootSmoothedHz[i]! += (tgt - this.padRootSmoothedHz[i]!) * rootK
    }

    for (let i = 0; i < this.padOscs.length; i++) {
      const base = this.padRootSmoothedHz[i]!
      const o = this.padOscs[i]!
      o.frequency.setTargetAtTime(base, now, 0.12)
    }

    if (now >= this.nextMelodyAt) {
      if (Math.random() < MELODY_REST_PROBABILITY) {
        this.nextMelodyAt = now + this.nextMelodyGapDelay()
      } else {
        this.playRandomNote(now)
        this.nextMelodyAt = now + this.nextMelodyGapDelay()
      }
    }
  }

  private playRandomNote(startTime: number): void {
    if (!this.ctx || !this.master) return

    const freq = pickRandom(PENTATONIC_HZ)
    const attack = 0.008 + Math.random() * 0.02
    const decay = 0.08 + Math.random() * 0.07
    const sustain = 0.04 + Math.random() * 0.08
    const release = 0.12 + Math.random() * 0.2
    const sustainLevel = NOTE_PEAK * (0.32 + Math.random() * 0.24)
    const t0 = Math.max(startTime, this.ctx.currentTime)

    const osc = this.ctx.createOscillator()
    osc.type = Math.random() < 0.75 ? 'triangle' : 'sine'
    osc.frequency.setValueAtTime(freq, t0)

    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(NOTE_PEAK, t0 + attack)
    g.gain.exponentialRampToValueAtTime(sustainLevel, t0 + attack + decay)
    g.gain.setValueAtTime(sustainLevel, t0 + attack + decay + sustain)
    const end = t0 + attack + decay + sustain + release
    g.gain.exponentialRampToValueAtTime(0.0008, end)

    osc.connect(g)
    g.connect(this.master)
    osc.start(t0)
    osc.stop(end + 0.05)
  }

  private nextPadNoteSwitchDelay(): number {
    return PAD_NOTE_SWITCH_MIN_S + Math.random() * (PAD_NOTE_SWITCH_MAX_S - PAD_NOTE_SWITCH_MIN_S)
  }

  private nextMelodyGapDelay(): number {
    return MELODY_GAP_MIN_S + Math.random() * (MELODY_GAP_MAX_S - MELODY_GAP_MIN_S)
  }

  private randomizePadTimbre(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime

    for (let i = 0; i < this.padOscs.length; i++) {
      const o = this.padOscs[i]!
      o.type = pickRandom(PAD_WAVESHAPES)

      const f = this.padFilters[i]
      if (f) {
        const cutoff =
          PAD_FILTER_FREQ_MIN + Math.random() * (PAD_FILTER_FREQ_MAX - PAD_FILTER_FREQ_MIN)
        f.frequency.setTargetAtTime(cutoff, t, 0.28)
      }
    }
  }

  private randomizePadNotesAndTimbre(): void {
    if (this.padPendingPoolStep !== this.padPoolStep) {
      this.padPoolStep = this.padPendingPoolStep
      this.padHzPool = padWindowFrequencies(this.padPoolStep)
    }

    for (let i = 0; i < this.padRootTargetHz.length; i++) {
      this.padRootTargetHz[i] = pickRandom(this.padHzPool)
    }
    this.randomizePadTimbre()
  }

  destroy(): void {
    this.running = false
    if (!this.ctx) return

    try {
      for (const o of this.padOscs) {
        try {
          o.stop()
          o.disconnect()
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    this.padOscs = []

    try {
      for (const f of this.padFilters) {
        try {
          f.disconnect()
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    this.padFilters = []

    try {
      this.padGain?.disconnect()
      this.master?.disconnect()
    } catch {
      /* ignore */
    }
    this.padGain = null
    this.master = null

    void this.ctx.close()
    this.ctx = null
  }
}

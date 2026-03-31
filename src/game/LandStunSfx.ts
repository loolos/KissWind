/**
 * One-shot procedural SFX for hull hitting land (stun entry). Web Audio, no asset files.
 */

const MASTER_GAIN = 0.2

let sharedCtx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null

function ensureGraph(): { ctx: AudioContext; master: GainNode } | null {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  if (!sharedCtx) {
    sharedCtx = new Ctx()
    master = sharedCtx.createGain()
    master.gain.value = MASTER_GAIN
    master.connect(sharedCtx.destination)
  }
  return { ctx: sharedCtx, master: master! }
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer
  const len = Math.floor(ctx.sampleRate * 0.07)
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = noiseBuffer.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return noiseBuffer
}

/**
 * @param impact Inward ground speed into land (same units as physics); scales loudness and brightness.
 */
export function playLandStunCollision(impact: number): void {
  const g = ensureGraph()
  if (!g) return
  const { ctx, master: m } = g
  void ctx.resume()

  const t0 = ctx.currentTime
  const imp = Math.min(14, Math.max(0, impact))
  const peak = Math.min(0.95, 0.28 + imp * 0.042)

  // Low hull–rock thud with pitch drop
  const thud = ctx.createOscillator()
  thud.type = 'sine'
  const f0 = 88 + imp * 1.8
  thud.frequency.setValueAtTime(f0, t0)
  thud.frequency.exponentialRampToValueAtTime(48, t0 + 0.14)
  const gThud = ctx.createGain()
  gThud.gain.setValueAtTime(0, t0)
  gThud.gain.linearRampToValueAtTime(peak * 0.62, t0 + 0.01)
  gThud.gain.exponentialRampToValueAtTime(0.0009, t0 + 0.32)
  thud.connect(gThud)
  gThud.connect(m)
  thud.start(t0)
  thud.stop(t0 + 0.35)

  // Short mid “crack / scrape”
  const crack = ctx.createOscillator()
  crack.type = 'triangle'
  crack.frequency.setValueAtTime(220 + imp * 5, t0)
  crack.frequency.exponentialRampToValueAtTime(90, t0 + 0.05)
  const gCrack = ctx.createGain()
  gCrack.gain.setValueAtTime(0, t0)
  gCrack.gain.linearRampToValueAtTime(peak * 0.22, t0 + 0.004)
  gCrack.gain.exponentialRampToValueAtTime(0.0009, t0 + 0.1)
  crack.connect(gCrack)
  gCrack.connect(m)
  crack.start(t0)
  crack.stop(t0 + 0.12)

  // Band-limited noise burst (impact texture)
  const buf = getNoiseBuffer(ctx)
  const noise = ctx.createBufferSource()
  noise.buffer = buf
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 180 + Math.min(imp * 35, 420)
  bp.Q.value = 0.85
  const gNoise = ctx.createGain()
  gNoise.gain.setValueAtTime(0, t0)
  gNoise.gain.linearRampToValueAtTime(peak * 0.2, t0 + 0.003)
  gNoise.gain.exponentialRampToValueAtTime(0.0009, t0 + 0.055)
  noise.connect(bp)
  bp.connect(gNoise)
  gNoise.connect(m)
  noise.start(t0)
  noise.stop(t0 + 0.08)

  // Brief high ping (ding), scales slightly with impact
  if (imp > 0.12) {
    const ping = ctx.createOscillator()
    ping.type = 'sine'
    ping.frequency.setValueAtTime(1400 + imp * 40, t0)
    const gPing = ctx.createGain()
    gPing.gain.setValueAtTime(0, t0)
    gPing.gain.linearRampToValueAtTime(peak * 0.08 * Math.min(1, imp / 3), t0 + 0.002)
    gPing.gain.exponentialRampToValueAtTime(0.0009, t0 + 0.045)
    ping.connect(gPing)
    gPing.connect(m)
    ping.start(t0)
    ping.stop(t0 + 0.06)
  }
}

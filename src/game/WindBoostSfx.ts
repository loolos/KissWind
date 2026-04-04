/**
 * One-shot procedural SFX for wind-boost pickup. Web Audio, no asset files.
 */

const MASTER_GAIN = 0.18

let sharedCtx: AudioContext | null = null
let master: GainNode | null = null

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

export function playWindBoostPickup(): void {
  const g = ensureGraph()
  if (!g) return
  const { ctx, master: m } = g
  void ctx.resume()

  const t0 = ctx.currentTime

  const noiseLen = Math.floor(ctx.sampleRate * 0.12)
  const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < noiseLen; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen)

  const noise = ctx.createBufferSource()
  noise.buffer = buf
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(520, t0)
  bp.frequency.exponentialRampToValueAtTime(1800, t0 + 0.06)
  bp.Q.value = 0.85
  const gN = ctx.createGain()
  gN.gain.setValueAtTime(0, t0)
  gN.gain.linearRampToValueAtTime(0.38, t0 + 0.012)
  gN.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.11)
  noise.connect(bp)
  bp.connect(gN)
  gN.connect(m)
  noise.start(t0)
  noise.stop(t0 + 0.13)

  const whoosh = ctx.createOscillator()
  whoosh.type = 'sine'
  whoosh.frequency.setValueAtTime(140, t0)
  whoosh.frequency.exponentialRampToValueAtTime(55, t0 + 0.18)
  const gW = ctx.createGain()
  gW.gain.setValueAtTime(0, t0)
  gW.gain.linearRampToValueAtTime(0.22, t0 + 0.02)
  gW.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.22)
  whoosh.connect(gW)
  gW.connect(m)
  whoosh.start(t0)
  whoosh.stop(t0 + 0.24)
}

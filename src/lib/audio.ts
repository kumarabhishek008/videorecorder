// Audio mixer: mic + system audio into one track, with an optional voice-isolation chain.

const NOISE_GATE_WORKLET = `
class NoiseGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0 },
      { name: 'floor', defaultValue: 0.03, minValue: 0, maxValue: 1 },
    ]
  }
  constructor() {
    super()
    this.env = 0
    this.gain = 1
    this.hold = 0
  }
  process(inputs, outputs, params) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) return true
    const threshold = Math.pow(10, params.threshold[0] / 20)
    const floor = params.floor[0]
    const attack = 1 - Math.exp(-1 / (sampleRate * 0.004))
    const release = 1 - Math.exp(-1 / (sampleRate * 0.12))
    const envCoef = 1 - Math.exp(-1 / (sampleRate * 0.01))
    const holdSamples = sampleRate * 0.15
    const n = input[0].length
    for (let i = 0; i < n; i++) {
      let peak = 0
      for (let c = 0; c < input.length; c++) peak = Math.max(peak, Math.abs(input[c][i]))
      this.env += (peak - this.env) * envCoef
      if (this.env > threshold) this.hold = holdSamples
      else if (this.hold > 0) this.hold--
      const target = this.hold > 0 ? 1 : floor
      this.gain += (target - this.gain) * (target > this.gain ? attack : release)
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] ? input[c][i] : input[0][i]) * this.gain
    }
    return true
  }
}
registerProcessor('noise-gate', NoiseGate)
`

export interface MicOptions {
  voiceIsolation: boolean
  noiseGate: boolean
}

export class AudioMixer {
  readonly ctx: AudioContext
  readonly destination: MediaStreamAudioDestinationNode
  private micGain: GainNode
  private sysGain: GainNode
  private micAnalyser: AnalyserNode
  private sysAnalyser: AnalyserNode
  private micNodes: AudioNode[] = []
  private sysSource: MediaStreamAudioSourceNode | null = null
  private workletReady: Promise<boolean>
  private micLevel = 0
  private micVolume = 1
  private muted = false
  private buf = new Float32Array(2048)

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    this.destination = this.ctx.createMediaStreamDestination()
    this.micGain = this.ctx.createGain()
    this.sysGain = this.ctx.createGain()
    this.micAnalyser = this.ctx.createAnalyser()
    this.sysAnalyser = this.ctx.createAnalyser()
    this.micAnalyser.fftSize = this.sysAnalyser.fftSize = 2048
    this.micGain.connect(this.micAnalyser)
    this.micGain.connect(this.destination)
    this.sysGain.connect(this.sysAnalyser)
    this.sysGain.connect(this.destination)
    const url = URL.createObjectURL(new Blob([NOISE_GATE_WORKLET], { type: 'application/javascript' }))
    this.workletReady = this.ctx.audioWorklet
      .addModule(url)
      .then(() => true)
      .catch(() => false)
      .finally(() => URL.revokeObjectURL(url))
  }

  get stream() {
    return this.destination.stream
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume()
  }

  async setMic(stream: MediaStream | null, opts: MicOptions) {
    this.micNodes.forEach((n) => n.disconnect())
    this.micNodes = []
    if (!stream || stream.getAudioTracks().length === 0) return
    const ctx = this.ctx
    const source = ctx.createMediaStreamSource(stream)
    const chain: AudioNode[] = [source]

    if (opts.voiceIsolation) {
      // Cut rumble below the voice band, tame hiss above it, add a little presence.
      const highpass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 90, Q: 0.7 })
      const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 11000, Q: 0.7 })
      const mud = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 300, Q: 1, gain: -2 })
      const presence = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 3200, Q: 1, gain: 2.5 })
      chain.push(highpass, lowpass, mud, presence)
    }
    if (opts.noiseGate && (await this.workletReady)) {
      chain.push(new AudioWorkletNode(ctx, 'noise-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }))
    }
    if (opts.voiceIsolation) {
      const compressor = new DynamicsCompressorNode(ctx, { threshold: -26, knee: 24, ratio: 4, attack: 0.004, release: 0.2 })
      const makeup = new GainNode(ctx, { gain: 1.6 })
      chain.push(compressor, makeup)
    }
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1])
    chain[chain.length - 1].connect(this.micGain)
    this.micNodes = chain
  }

  setSystem(stream: MediaStream | null) {
    this.sysSource?.disconnect()
    this.sysSource = null
    if (!stream || stream.getAudioTracks().length === 0) return
    this.sysSource = this.ctx.createMediaStreamSource(stream)
    this.sysSource.connect(this.sysGain)
  }

  setMicVolume(v: number) {
    this.micVolume = v
    this.micGain.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.02)
  }

  setMicMuted(m: boolean) {
    this.muted = m
    this.setMicVolume(this.micVolume)
  }

  setSystemVolume(v: number) {
    this.sysGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
  }

  /** Smoothed level 0..1 for meters. */
  level(which: 'mic' | 'system' = 'mic'): number {
    const analyser = which === 'mic' ? this.micAnalyser : this.sysAnalyser
    analyser.getFloatTimeDomainData(this.buf)
    const v = rmsToLevel(this.buf)
    if (which === 'system') return v
    this.micLevel = v > this.micLevel ? v : this.micLevel * 0.85 + v * 0.15
    return this.micLevel
  }

  close() {
    this.micNodes.forEach((n) => n.disconnect())
    this.sysSource?.disconnect()
    this.destination.stream.getTracks().forEach((t) => t.stop())
    closeContext(this.ctx)
  }
}

export function closeContext(ctx: AudioContext) {
  if (ctx.state !== "closed") ctx.close().catch(() => {})
}

export function rmsToLevel(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  const rms = Math.sqrt(sum / buf.length)
  const db = 20 * Math.log10(rms + 1e-9)
  return Math.min(1, Math.max(0, (db + 60) / 60))
}

/** Lightweight standalone meter for previewing a mic before recording. */
export class LevelMeter {
  private ctx = new AudioContext()
  private analyser = this.ctx.createAnalyser()
  private source: MediaStreamAudioSourceNode
  private buf = new Float32Array(1024)
  // Contexts created before any user click start suspended (autoplay policy); wake on first interaction.
  private wake = () => {
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
  }
  constructor(stream: MediaStream) {
    this.analyser.fftSize = 1024
    this.source = this.ctx.createMediaStreamSource(stream)
    this.source.connect(this.analyser)
    this.wake()
    document.addEventListener('pointerdown', this.wake)
    document.addEventListener('keydown', this.wake)
  }
  level() {
    this.analyser.getFloatTimeDomainData(this.buf)
    return rmsToLevel(this.buf)
  }
  close() {
    document.removeEventListener('pointerdown', this.wake)
    document.removeEventListener('keydown', this.wake)
    this.source.disconnect()
    closeContext(this.ctx)
  }
}

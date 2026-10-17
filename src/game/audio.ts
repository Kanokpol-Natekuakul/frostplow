/**
 * FrostPlow: Cozy Procedural Web Audio Synth Engine
 * Pure synthesized audio using Web Audio API oscillators, noise generators, and filters.
 * Zero external audio assets (100% procedural).
 */

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted: boolean = false;
  private initialized: boolean = false;

  // Engine hum nodes
  private engineOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  // Snow plowing swish / crunch noise nodes
  private snowNoiseNode: AudioNode | null = null;
  private snowFilter: BiquadFilterNode | null = null;
  private snowGain: GainNode | null = null;

  // Ambient wind nodes
  private windNoiseNode: AudioNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private pentatonicNotes = [
    261.63, // C4
    293.66, // D4
    329.63, // E4
    392.00, // G4
    440.00, // A4
    523.25, // C5
    587.33, // D5
    659.25, // E5
  ];

  constructor() {
    // Lazy initialized on first user gesture
  }

  public init(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.8, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.initEngineSound();
      this.initSnowCrunchSound();
      this.initAmbientWindSound();

      this.initialized = true;
    } catch {
      // AudioContext unavailable (e.g. headless)
    }
  }

  private createNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      // Pinkish/soft white noise
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }
    return buffer;
  }

  private initEngineSound(): void {
    if (!this.ctx || !this.masterGain) return;
    try {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'triangle';
      this.engineOsc.frequency.setValueAtTime(45, this.ctx.currentTime);

      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.setValueAtTime(140, this.ctx.currentTime);

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(0.04, this.ctx.currentTime);

      this.engineOsc.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineOsc.start();
    } catch {
      // Fallback
    }
  }

  private initSnowCrunchSound(): void {
    if (!this.ctx || !this.masterGain) return;
    try {
      const noiseBuffer = this.createNoiseBuffer();
      if (!noiseBuffer) return;

      const source = this.ctx.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;

      this.snowFilter = this.ctx.createBiquadFilter();
      this.snowFilter.type = 'bandpass';
      this.snowFilter.frequency.setValueAtTime(650, this.ctx.currentTime);
      this.snowFilter.Q.setValueAtTime(1.8, this.ctx.currentTime);

      this.snowGain = this.ctx.createGain();
      this.snowGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

      source.connect(this.snowFilter);
      this.snowFilter.connect(this.snowGain);
      this.snowGain.connect(this.masterGain);

      source.start();
      this.snowNoiseNode = source;
    } catch {
      // Fallback
    }
  }

  private initAmbientWindSound(): void {
    if (!this.ctx || !this.masterGain) return;
    try {
      const noiseBuffer = this.createNoiseBuffer();
      if (!noiseBuffer) return;

      const source = this.ctx.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;

      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windFilter.frequency.setValueAtTime(320, this.ctx.currentTime);

      this.windGain = this.ctx.createGain();
      this.windGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

      source.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.masterGain);

      source.start();
      this.windNoiseNode = source;
    } catch {
      // Fallback
    }
  }

  /**
   * Modulate engine and snow sounds every frame based on player velocity and plowing
   */
  public updateFrame(speedRatio: number, isPlowing: boolean, windVolume: number): void {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    // Engine pitch and rumble
    if (this.engineOsc && this.engineGain && this.engineFilter) {
      const targetFreq = 42 + speedRatio * 38;
      const targetGain = 0.03 + speedRatio * 0.05;
      const targetFilter = 130 + speedRatio * 180;

      this.engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.08);
      this.engineGain.gain.setTargetAtTime(targetGain, now, 0.08);
      this.engineFilter.frequency.setTargetAtTime(targetFilter, now, 0.08);
    }

    // Snow crunching swish
    if (this.snowGain && this.snowFilter) {
      const targetSnowGain = isPlowing ? Math.min(0.28, 0.05 + speedRatio * 0.23) : 0.0;
      const targetFilterFreq = 500 + speedRatio * 500;
      this.snowGain.gain.setTargetAtTime(targetSnowGain, now, 0.06);
      this.snowFilter.frequency.setTargetAtTime(targetFilterFreq, now, 0.06);
    }

    // Wind volume
    if (this.windGain && this.windFilter) {
      const targetWindGain = Math.max(0.02, windVolume * 0.35);
      const targetFilter = 280 + windVolume * 450;
      this.windGain.gain.setTargetAtTime(targetWindGain, now, 0.2);
      this.windFilter.frequency.setTargetAtTime(targetFilter, now, 0.2);
    }
  }

  /**
   * Harmonious pentatonic combo milestone chime
   */
  public playComboChime(comboLevel: number): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    const noteIdx = Math.min(this.pentatonicNotes.length - 1, Math.floor(comboLevel * 1.5));
    const baseFreq = this.pentatonicNotes[noteIdx];

    // Rich dual-oscillator bell tone (sine + soft triangle)
    [baseFreq, baseFreq * 1.5].forEach((freq, i) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12 / (i + 1), now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.7);
    });
  }

  /**
   * Cozy chord chime when buying an upgrade
   */
  public playUpgradeDing(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;
    const chord = [349.23, 440.00, 523.25, 659.25]; // Fmaj7

    chord.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      const startTime = now + idx * 0.06;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + 0.85);
    });
  }

  /**
   * Snow blower turbo whoosh
   */
  public playBlowerBlast(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    const noiseBuffer = this.createNoiseBuffer();
    if (!noiseBuffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.Q.setValueAtTime(2.5, now);
    filter.frequency.exponentialRampToValueAtTime(400, now + 0.7);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    source.start(now);
    source.stop(now + 0.75);
  }

  /**
   * Toggle audio mute
   */
  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.8, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }
}

export const soundEngine = new SoundEngine();

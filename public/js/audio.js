// Tiny WebAudio synth – no asset downloads, works offline.
// iOS only allows audio after a user gesture, so unlock() is called on the
// first touch/click.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.engine = null;
    this.siren = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.setupEngine();
    this.setupSiren();
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  noiseBuffer(dur = 0.4) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  blast({ dur = 0.18, freq = 380, type = 'square', vol = 0.4, noise = 0.5, sweep = 0.25 }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.t;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(this.master);

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    osc.connect(g);
    osc.start(t); osc.stop(t + dur);

    if (noise > 0) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer(dur);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(vol * noise, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(2600, t);
      src.connect(filt); filt.connect(ng); ng.connect(this.master);
      src.start(t); src.stop(t + dur);
    }
  }

  shot(weapon, volume = 1) {
    if (!this.ctx) return;
    switch (weapon) {
      case 0: this.blast({ dur: 0.08, freq: 190, type: 'sine', vol: 0.22 * volume, noise: 0.7 }); break;
      case 1: this.blast({ dur: 0.13, freq: 620, vol: 0.3 * volume, noise: 0.6 }); break;
      case 2: this.blast({ dur: 0.07, freq: 760, vol: 0.2 * volume, noise: 0.5 }); break;
      case 3: this.blast({ dur: 0.3, freq: 300, vol: 0.4 * volume, noise: 1.1 }); break;
      case 4: this.blast({ dur: 0.5, freq: 160, type: 'sawtooth', vol: 0.4 * volume, noise: 0.8 }); break;
      default: this.blast({ dur: 0.12, freq: 500, vol: 0.25 * volume, noise: 0.6 });
    }
  }

  boom(volume = 1) { this.blast({ dur: 0.85, freq: 130, type: 'sawtooth', vol: 0.55 * volume, noise: 1.4, sweep: 0.12 }); }
  crash(mag = 0.5) { this.blast({ dur: 0.2 + mag * 0.2, freq: 240 - mag * 80, type: 'square', vol: 0.16 + mag * 0.3, noise: 1.2 }); }
  pickup() { this.blast({ dur: 0.16, freq: 880, type: 'triangle', vol: 0.3, noise: 0, sweep: 2.4 }); }
  hurt() { this.blast({ dur: 0.18, freq: 220, type: 'sawtooth', vol: 0.3, noise: 0.4 }); }
  die() { this.blast({ dur: 0.7, freq: 300, type: 'sawtooth', vol: 0.35, noise: 0.6, sweep: 0.1 }); }

  setupEngine() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    osc.type = 'sawtooth'; osc2.type = 'square';
    osc.frequency.value = 60; osc2.frequency.value = 30;
    filt.type = 'lowpass'; filt.frequency.value = 700;
    gain.gain.value = 0;
    osc.connect(filt); osc2.connect(filt); filt.connect(gain); gain.connect(this.master);
    osc.start(); osc2.start();
    this.engine = { osc, osc2, gain };
  }

  // speed 0..1, inCar toggles the engine on
  updateEngine(inCar, speed) {
    if (!this.engine || !this.ctx) return;
    const t = this.t;
    const target = inCar ? 0.05 + speed * 0.13 : 0;
    this.engine.gain.gain.setTargetAtTime(target, t, 0.12);
    const f = 55 + speed * 150;
    this.engine.osc.frequency.setTargetAtTime(f, t, 0.08);
    this.engine.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
  }

  setupSiren() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = 'square'; osc.frequency.value = 700;
    lfo.type = 'square'; lfo.frequency.value = 2.2;
    lfoGain.gain.value = 210;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    gain.gain.value = 0;
    osc.connect(gain); gain.connect(this.master);
    osc.start(); lfo.start();
    this.siren = { osc, gain };
  }

  updateSiren(closeness) { // 0 = no cops nearby, 1 = right next to you
    if (!this.siren || !this.ctx) return;
    this.siren.gain.gain.setTargetAtTime(closeness * 0.05, this.t, 0.25);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }
}

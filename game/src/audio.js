// audio.js — synthesized WebAudio effects. No assets, no network.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }

  _noiseBuf(dur) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return buf;
  }

  _burst(dur, filterFreq, gain, type = 'lowpass') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(dur);
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  }

  _tone(freq, dur, gain, type = 'sine', slideTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur);
  }

  shot(kind) {
    if (kind === 'rifle') { this._burst(0.14, 1800, 0.9); this._tone(160, 0.08, 0.35, 'square', 60); }
    else if (kind === 'pistol') { this._burst(0.1, 2400, 0.6); this._tone(220, 0.06, 0.25, 'square', 90); }
    else { this._burst(0.09, 900, 0.3); }
  }

  enemyShot() { this._burst(0.12, 1200, 0.22); }
  reload() { this._tone(900, 0.05, 0.18, 'square'); setTimeout(() => this._tone(1200, 0.05, 0.18, 'square'), 160); }
  dryFire() { this._tone(1400, 0.04, 0.15, 'square'); }
  hit() { this._tone(2400, 0.05, 0.3, 'sine'); }
  headshot() { this._tone(2400, 0.05, 0.3, 'sine'); setTimeout(() => this._tone(3200, 0.06, 0.3, 'sine'), 60); }
  hurt() { this._tone(180, 0.12, 0.4, 'sawtooth', 90); }
  explosion() {
    this._burst(0.7, 400, 1.0);
    this._tone(70, 0.6, 0.7, 'sine', 30);
  }
  plant() { this._tone(660, 0.1, 0.25, 'square'); setTimeout(() => this._tone(880, 0.12, 0.25, 'square'), 120); }
  beep() { this._tone(1100, 0.08, 0.2, 'square'); }
  win() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 0.3, 'triangle'), i * 140)); }
  lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.25, 0.3, 'triangle'), i * 160)); }
  buy() { this._tone(980, 0.07, 0.25, 'triangle'); setTimeout(() => this._tone(1318, 0.09, 0.25, 'triangle'), 80); }
  denied() { this._tone(220, 0.15, 0.3, 'sawtooth', 160); }
}

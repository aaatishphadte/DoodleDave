// Synthesized audio: a small bus mixer, varied SFX and an adaptive procedural score.
// No audio files needed.
//
//   sfx ─────────────────────────────┐
//   music → lowpass (pause) → duck ──┼─→ master → compressor → speakers
//
// Settings sliders (0..1) are squared before use so the audible change spreads over the whole range.

let ctx;
let muted = false;
let bus = null;
let noiseBuf = null;
const levels = { music: 0.7, sfx: 0.9 };

function build() {
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor(); // glue + safety limiter so stacked sounds never clip
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6;
  comp.attack.value = 0.003; comp.release.value = 0.2;
  master.gain.value = 0.9;
  master.connect(comp).connect(ctx.destination);

  const sfx = ctx.createGain();
  sfx.connect(master);

  const music = ctx.createGain();
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass'; lowpass.frequency.value = 18000;
  const duck = ctx.createGain();
  music.connect(lowpass).connect(duck).connect(master);

  bus = { master, sfx, music, lowpass, duck };
  applyLevels();

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function applyLevels() {
  if (!bus) return;
  const t = ctx.currentTime;
  bus.sfx.gain.setTargetAtTime(levels.sfx * levels.sfx, t, 0.05);
  bus.music.gain.setTargetAtTime(levels.music * levels.music * 0.55, t, 0.05);
}

export function setVolumes({ music, sfx }) {
  if (music != null) levels.music = music;
  if (sfx != null) levels.sfx = sfx;
  applyLevels();
}

// Ads must play with the game silent.
export function setMuted(on) {
  muted = on;
  try { if (ctx) on ? ctx.suspend() : ctx.resume(); } catch { /* ignore */ }
}

// iOS/Android only let audio start inside a user gesture, so unlock on the first touch/click/key.
export function unlockAudio() {
  try {
    if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); build(); }
    if (ctx.state !== 'running' && !muted) ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
    music.kick();
  } catch { /* audio is optional */ }
}

const live = () => ctx && bus && ctx.state === 'running';

// ---------- voices ----------

function tone(freq, dur, { type = 'square', vol = 0.06, slide = 0, delay = 0, vary = 0.03, out, at, attack = 0.004 } = {}) {
  try {
    if (!live()) return;
    const t = at ?? ctx.currentTime + delay;
    const f = freq * (1 + (Math.random() * 2 - 1) * vary); // small pitch variation: no machine-gun repeats
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(out || bus.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch { /* audio is optional */ }
}

function noise(dur, { vol = 0.08, freq = 1200, q = 0.8, type = 'bandpass', delay = 0, out, at } = {}) {
  try {
    if (!live()) return;
    const t = at ?? ctx.currentTime + delay;
    const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(gain).connect(out || bus.sfx);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  } catch { /* audio is optional */ }
}

// Briefly dip the music under an important stinger, then recover.
function duck(depth = 0.35, hold = 0.5) {
  if (!live()) return;
  const g = bus.duck.gain, t = ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setTargetAtTime(depth, t, 0.03);
  g.setTargetAtTime(1, t + hold, 0.25);
}

// Gem pickups climb a little scale while you chain them quickly.
let gemChain = 0, gemLast = 0;
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];

export const sfx = {
  jump: () => { tone(330, 0.13, { slide: 280, vol: 0.05, type: 'square' }); noise(0.06, { vol: 0.03, freq: 2500 }); },
  land: (hard = 0.5) => noise(0.09 + hard * 0.06, { vol: 0.04 + hard * 0.07, freq: 380 + hard * 200, q: 1.2, type: 'lowpass' }),
  step: () => noise(0.04, { vol: 0.018, freq: 1800, q: 2 }),
  gem: () => {
    const now = performance.now();
    gemChain = now - gemLast < 900 ? Math.min(gemChain + 1, PENTA.length - 1) : 0;
    gemLast = now;
    const f = 880 * 2 ** (PENTA[gemChain] / 12);
    tone(f, 0.07, { type: 'square', vol: 0.045, vary: 0 }); tone(f * 1.5, 0.12, { delay: 0.05, type: 'triangle', vol: 0.06, vary: 0 });
  },
  star: () => { duck(0.25, 0.9); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, { delay: i * 0.08, type: 'triangle', vol: 0.1, vary: 0 })); },
  pickup: () => { duck(0.5, 0.4); tone(440, 0.08, { type: 'triangle', vol: 0.1 }); tone(660, 0.14, { delay: 0.07, type: 'triangle', vol: 0.1 }); tone(880, 0.16, { delay: 0.14, type: 'triangle', vol: 0.08 }); },
  checkpoint: () => { duck(0.5, 0.4); [392, 587, 784].forEach((f, i) => tone(f, 0.18, { delay: i * 0.07, type: 'triangle', vol: 0.09, vary: 0 })); },
  shoot: () => { tone(700, 0.1, { type: 'sawtooth', slide: -500, vol: 0.04 }); noise(0.08, { vol: 0.04, freq: 3000 }); },
  splat: () => { tone(160, 0.18, { type: 'sawtooth', slide: -110, vol: 0.07 }); noise(0.16, { vol: 0.09, freq: 600, q: 0.6 }); },
  stomp: () => { tone(220, 0.12, { type: 'square', slide: -120, vol: 0.07 }); tone(520, 0.12, { delay: 0.04, type: 'triangle', slide: 300, vol: 0.06 }); noise(0.12, { vol: 0.08, freq: 500 }); },
  die: () => { duck(0.15, 1.1); tone(440, 0.6, { type: 'sawtooth', slide: -390, vol: 0.08 }); noise(0.3, { vol: 0.08, freq: 400, type: 'lowpass' }); },
  door: () => { duck(0.1, 2.2); [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.24, { delay: i * 0.08, type: 'triangle', vol: 0.1, vary: 0 })); },
  locked: () => { tone(140, 0.15, { vol: 0.05 }); tone(110, 0.15, { delay: 0.1, vol: 0.05 }); },
  rocket: () => noise(0.12, { vol: 0.035, freq: 900, q: 0.5 }),
  ui: () => tone(660, 0.05, { type: 'triangle', vol: 0.05 }),
  uiMove: () => tone(520, 0.03, { type: 'triangle', vol: 0.03 }),
  rating: (i) => tone(660 * 2 ** (i * 4 / 12), 0.2, { type: 'triangle', vol: 0.09, vary: 0 }),
};

// ---------- adaptive music ----------
// A tiny look-ahead sequencer on the Web Audio clock (sample-accurate, immune to frame drops).
// Vertical layering: the base groove always plays; the melody joins once the star is collected
// (intensity 1) and hats join near the end (intensity 2). Each page gets its own key, tempo and tune.

const CHORDS = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]]; // I vi IV V
const SONGS = [
  { root: 60, bpm: 108, seed: 11 }, // title
  { root: 62, bpm: 112, seed: 3 },
  { root: 57, bpm: 118, seed: 8 },
  { root: 64, bpm: 116, seed: 21 },
  { root: 59, bpm: 122, seed: 34 },
  { root: 61, bpm: 128, seed: 55 },
];
const midi = n => 440 * 2 ** ((n - 69) / 12);

function melodyFor(seed) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (let bar = 0; bar < 4; bar++) {
    const row = [];
    for (let step = 0; step < 16; step++) {
      const strong = step % 4 === 0;
      if (r() < (strong ? 0.75 : 0.28)) {
        const ch = CHORDS[bar];
        const note = r() < 0.7 ? ch[Math.floor(r() * 3)] : ch[0] + [2, 5, 9][Math.floor(r() * 3)];
        row.push(note + 12);
      } else row.push(null);
    }
    out.push(row);
  }
  return out;
}

export const music = {
  want: null,     // song index we'd like to play (title = 0, page n = n + 1)
  song: null,
  intensity: 0,
  step: 0,
  next: 0,
  timer: 0,
  layers: null,

  play(index) {
    this.want = index;
    this.intensity = 0;
    this.kick();
  },

  stop() { this.want = null; this.halt(); },

  kick() {
    if (!live() || this.want == null) return;
    if (this.song && this.song.index === this.want && this.timer) return;
    this.halt();
    const def = SONGS[Math.min(this.want, SONGS.length - 1)];
    this.song = { index: this.want, ...def, mel: melodyFor(def.seed) };
    this.layers = { base: ctx.createGain(), lead: ctx.createGain(), hats: ctx.createGain() };
    for (const g of Object.values(this.layers)) g.connect(bus.music);
    this.layers.lead.gain.value = this.intensity >= 1 ? 1 : 0;
    this.layers.hats.gain.value = this.intensity >= 2 ? 1 : 0;
    this.step = 0;
    this.next = ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 25);
  },

  halt() {
    clearInterval(this.timer);
    this.timer = 0;
    if (this.layers && live()) for (const g of Object.values(this.layers)) g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    this.layers = null;
    this.song = null;
  },

  setIntensity(n) {
    this.intensity = n;
    if (!this.layers || !live()) return;
    const t = ctx.currentTime;
    this.layers.lead.gain.setTargetAtTime(n >= 1 ? 1 : 0, t, 0.6);
    this.layers.hats.gain.setTargetAtTime(n >= 2 ? 1 : 0, t, 0.6);
  },

  // Paused / menus: muffle the score rather than cutting it.
  setMuffled(on) {
    if (!live()) return;
    bus.lowpass.frequency.setTargetAtTime(on ? 700 : 18000, ctx.currentTime, 0.15);
  },

  schedule() {
    if (!live() || !this.song) return;
    const sixteenth = 60 / this.song.bpm / 4;
    while (this.next < ctx.currentTime + 0.15) {
      this.voice(this.step, this.next, sixteenth);
      this.next += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  },

  voice(step, at, len) {
    const { root, mel } = this.song, L = this.layers;
    const bar = Math.floor(step / 16), s = step % 16, ch = CHORDS[bar];
    // base: bass on the beat, soft chord stabs on the off-beats, a felt-tip "tick" on 2 and 4
    if (s % 4 === 0) tone(midi(root - 24 + ch[0] + (s === 8 ? 12 : 0)), len * 3, { type: 'triangle', vol: 0.16, vary: 0, out: L.base, at, attack: 0.01 });
    if (s % 4 === 2) for (const n of ch) tone(midi(root + n), len * 1.6, { type: 'square', vol: 0.018, vary: 0, out: L.base, at, attack: 0.006 });
    if (s === 4 || s === 12) noise(0.07, { vol: 0.07, freq: 1400, q: 0.7, out: L.base, at });
    // lead layer
    const n = mel[bar][s];
    if (n != null) tone(midi(root + n), len * 2.2, { type: 'triangle', vol: 0.09, vary: 0, out: L.lead, at, attack: 0.008 });
    // hats layer
    if (s % 2 === 0) noise(0.03, { vol: s % 4 === 2 ? 0.05 : 0.025, freq: 7000, q: 1, type: 'highpass', out: L.hats, at });
  },
};

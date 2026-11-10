// Tiny synth sound effects, no audio files needed.
let ctx;

// iOS/Android only let audio start inside a user gesture, so unlock on the first touch/click/key.
export function unlockAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state !== 'running') ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* audio is optional */ }
}

function tone(freq, dur, { type = 'square', vol = 0.06, slide = 0, delay = 0 } = {}) {
  try {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  } catch { /* audio is optional */ }
}

export const sfx = {
  jump: () => tone(380, 0.14, { slide: 320 }),
  gem: () => { tone(880, 0.07); tone(1320, 0.1, { delay: 0.06 }); },
  star: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { delay: i * 0.09, type: 'triangle', vol: 0.1 })),
  pickup: () => { tone(440, 0.08, { type: 'triangle', vol: 0.1 }); tone(660, 0.14, { delay: 0.07, type: 'triangle', vol: 0.1 }); },
  shoot: () => tone(700, 0.1, { type: 'sawtooth', slide: -500, vol: 0.05 }),
  splat: () => tone(160, 0.18, { type: 'sawtooth', slide: -110, vol: 0.08 }),
  die: () => tone(440, 0.6, { type: 'sawtooth', slide: -390, vol: 0.08 }),
  door: () => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, { delay: i * 0.08, type: 'triangle', vol: 0.1 })),
  locked: () => tone(140, 0.15, { vol: 0.05 }),
};

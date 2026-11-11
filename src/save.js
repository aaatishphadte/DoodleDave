// Persistent progress + settings. Plain data, versioned, validated on load, never trusted blindly.
// Storage can be missing (private mode, blocked iframes on portals), so every access is guarded and
// the game runs fine with an in-memory copy.

const KEY = 'doodle-dash.save';
const VERSION = 1;

const defaults = () => ({
  version: VERSION,
  settings: { music: 0.7, sfx: 0.9, shake: true },
  unlocked: 1,          // pages 0..unlocked-1 can be chosen from the page select
  pages: {},            // index -> { best, stars, gems, time }
});

// Old saves are upgraded step by step: MIGRATIONS[v] turns a v save into a v+1 save.
const MIGRATIONS = {};

const num = (v, lo, hi, fb) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);

function validate(raw, pageCount) {
  const d = defaults();
  const s = raw.settings || {};
  d.settings.music = num(s.music, 0, 1, d.settings.music);
  d.settings.sfx = num(s.sfx, 0, 1, d.settings.sfx);
  d.settings.shake = typeof s.shake === 'boolean' ? s.shake : d.settings.shake;
  d.unlocked = Math.round(num(raw.unlocked, 1, pageCount, 1));
  for (const [k, p] of Object.entries(raw.pages || {})) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= pageCount || !p) continue;
    d.pages[i] = {
      best: Math.round(num(p.best, 0, 1e9, 0)),
      stars: Math.round(num(p.stars, 0, 3, 0)),
      gems: Math.round(num(p.gems, 0, 999, 0)),
      time: num(p.time, 0, 1e6, 0),
    };
  }
  return d;
}

function read(key) {
  try { const t = localStorage.getItem(key); return t ? JSON.parse(t) : null; } catch { return null; }
}

export function loadSave(pageCount) {
  for (const key of [KEY, KEY + '.bak']) {
    let data = read(key);
    if (!data || typeof data !== 'object') continue;
    let v = Number.isInteger(data.version) ? data.version : 1;
    if (v > VERSION) continue; // written by a newer build: don't clobber it, fall back
    while (v < VERSION && MIGRATIONS[v]) { data = MIGRATIONS[v](data); data.version = ++v; }
    return validate(data, pageCount);
  }
  return defaults();
}

export function writeSave(data) {
  try {
    const text = JSON.stringify({ ...data, version: VERSION });
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(KEY + '.bak', prev); // keep the last good save
    localStorage.setItem(KEY, text);
    return true;
  } catch { return false; } // quota / disabled storage: progress lives for this session only
}

// Record a finished page; returns which bests were beaten so the results screen can celebrate.
export function recordPage(save, index, { score, stars, gems, time }, pageCount) {
  const old = save.pages[index] || { best: 0, stars: 0, gems: 0, time: 0 };
  const result = { newBest: score > old.best, newStars: stars > old.stars, prevStars: old.stars };
  save.pages[index] = {
    best: Math.max(old.best, score),
    stars: Math.max(old.stars, stars),
    gems: Math.max(old.gems, gems),
    time: old.time ? Math.min(old.time, time) : time,
  };
  save.unlocked = Math.min(pageCount, Math.max(save.unlocked, index + 2));
  writeSave(save);
  return result;
}

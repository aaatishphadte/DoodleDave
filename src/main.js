import { Game } from './game.js';
import { LEVELS } from './levels.js';
import { unlockAudio, setMuted, setVolumes, music, sfx } from './audio.js';
import { platform } from './platform.js';
import { device, TouchControls, Gamepads } from './input.js';
import { loadSave, writeSave, recordPage } from './save.js';

const $ = id => document.getElementById(id);
const body = document.body;
let bannerTimer = 0;
let lastHud = '';
let current = null; // { back } of the menu currently shown

if (device.touch) body.classList.add('touch');
if (device.tv) body.classList.add('tv');
if (device.mobile && Math.min(window.screen.width, window.screen.height) < 600) body.classList.add('phone');

const save = loadSave(LEVELS.length);

$('device-tip').textContent = device.tv
  ? 'Remote: arrows to move, OK to jump. A game controller works too.'
  : device.touch
    ? 'Left thumb moves, right thumb looks. Tip: add to your home screen to play full screen.'
    : 'Keyboard + mouse, or plug in a controller.';

const focusable = () => [...$('ov-buttons').querySelectorAll('button:not(.hidden):not(:disabled)')];
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const starRow = n => '★'.repeat(n) + '☆'.repeat(3 - n);
const totalStars = () => Object.values(save.pages).reduce((a, p) => a + p.stars, 0);

// ---------- menu rendering ----------
// One overlay, many screens. Each screen is a title, text, optional extra node and a button list.
// Buttons: { label, action, alt, wide, disabled }. Settings toggles re-render their screen and pass
// `focus` so a controller doesn't lose its place.

function menu({ title, text = '', extra = null, buttons = [], back = null, home = false, focus = 0 }) {
  $('overlay').classList.remove('hidden');
  body.classList.remove('playing');
  body.classList.toggle('home', home);
  $('ov-title').textContent = title;
  $('ov-text').textContent = text;
  $('ov-text').classList.toggle('hidden', !text);
  const ex = $('ov-extra');
  ex.innerHTML = '';
  if (extra) ex.append(extra);
  const wrap = $('ov-buttons'), fs = $('ov-fs');
  wrap.querySelectorAll('button:not(#ov-fs)').forEach(b => b.remove());
  buttons.forEach((b, i) => {
    const el = document.createElement('button');
    el.textContent = b.label;
    if (b.alt) el.classList.add('alt');
    if (b.wide) el.classList.add('wide');
    el.disabled = !!b.disabled;
    el.addEventListener('click', () => { sfx.ui(); b.action?.(i); });
    wrap.insertBefore(el, fs);
  });
  fs.classList.toggle('hidden', !home || !canFs || !device.touch || !!document.fullscreenElement);
  current = { back };
  requestAnimationFrame(() => (focusable()[focus] || focusable()[0])?.focus({ preventScroll: true }));
}

const ui = {
  overlay(title) {
    if (title) return;
    $('overlay').classList.add('hidden');
    body.classList.add('playing');
    body.classList.remove('home');
    current = null;
    document.activeElement?.blur?.();
  },
  moveFocus(dir) {
    if ($('overlay').classList.contains('hidden')) return;
    const list = focusable();
    const i = list.indexOf(document.activeElement);
    list[(i + dir + list.length) % list.length]?.focus({ preventScroll: true });
    sfx.uiMove();
  },
  activate() {
    if ($('overlay').classList.contains('hidden')) return;
    const list = focusable();
    (list.includes(document.activeElement) ? document.activeElement : list[0])?.click();
  },
  back() { if (current?.back) { sfx.ui(); current.back(); } },
  showHud(on) {
    $('hud').classList.toggle('hidden', !on);
    $('help').classList.toggle('hidden', !on);
  },
  banner(title, sub = '') {
    const el = $('banner');
    el.innerHTML = '';
    el.append(title);
    const small = document.createElement('small');
    small.textContent = sub;
    el.append(small);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), 2600);
  },
  // Floating "+100" etc. that drift up from a point on screen.
  popup(x, y, text, kind) {
    const el = document.createElement('div');
    el.className = 'pop ' + (kind || '');
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.addEventListener('animationend', () => el.remove());
    $('pops').append(el);
  },
  // Page-turn wipe when a new page loads.
  wipe() {
    const el = $('wipe');
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  },
  hud(game) {
    const p = game.p, st = game.stats;
    const key = [game.score, game.lives, game.index, p.star, p.ink, Math.ceil(p.fuel), st.gems].join('|');
    if (key === lastHud) return;
    const prev = lastHud.split('|');
    lastHud = key;
    const bump = (id, changed) => { if (!changed) return; const el = $(id); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };
    $('score').textContent = game.score;
    bump('score-chip', prev[0] !== String(game.score) && prev.length > 1);
    $('lives').textContent = '♥'.repeat(Math.max(0, game.lives));
    bump('lives', prev[1] !== String(game.lives) && prev.length > 1);
    $('lvl').textContent = `Page ${game.index + 1} / ${LEVELS.length}`;
    $('gems').textContent = `◆ ${st.gems}/${st.gemsTotal}`;
    $('gems').classList.toggle('done', st.gems >= st.gemsTotal && st.gemsTotal > 0);
    bump('gems', prev[6] !== String(st.gems) && prev.length > 1);
    $('star').textContent = p.star ? '★ go to the door!' : '☆ find the Ink Star';
    $('star').classList.toggle('done', p.star);
    $('ink').style.display = p.ink ? '' : 'none';
    $('fuelwrap').style.display = p.fuel > 0 ? 'flex' : 'none';
    $('fuel').style.width = p.fuel + '%';
    $('fuel').classList.toggle('low', p.fuel < 25);
    $('t-ink').classList.toggle('off', !p.ink);
    $('t-rocket').classList.toggle('off', !(p.fuel > 0));
  },

  // ---------- screens ----------

  title() {
    game.state = 'title';
    const resume = Math.min(save.unlocked, LEVELS.length) - 1;
    const stars = totalStars();
    menu({
      home: true,
      title: 'Doodle Dash',
      text: 'Pip is a doodle who wants off the page. On every page, grab the Ink Star, then run for the door. Stomp the grumpy erasers, splat the scribble-flies and mind the pencil spikes.',
      extra: stars ? Object.assign(document.createElement('div'), { className: 'tally', textContent: `★ ${stars} / ${LEVELS.length * 3} stars collected` }) : null,
      buttons: [
        resume > 0
          ? { label: `Continue · Page ${resume + 1}`, action: () => game.newGame(resume) }
          : { label: 'Start drawing', action: () => game.newGame(0) },
        { label: 'Pages', alt: true, action: () => ui.pages() },
        { label: 'Settings', alt: true, action: () => ui.settings(() => ui.title()) },
      ],
    });
  },

  pages() {
    const grid = document.createElement('div');
    grid.className = 'pages';
    menu({
      title: 'Pages',
      text: 'Clear a page to unlock the next. ★ clear · ★ every gem · ★ beat the par time.',
      back: () => ui.title(),
      buttons: [
        ...LEVELS.map((L, i) => {
          const rec = save.pages[i];
          const locked = i >= save.unlocked;
          const name = L.name.split('—')[1]?.trim() || L.name;
          return {
            wide: true,
            label: locked ? `🔒 ${i + 1}. ???` : `${i + 1}. ${name}   ${starRow(rec?.stars || 0)}${rec ? `   best ${rec.best}` : ''}`,
            disabled: locked,
            alt: true,
            action: () => game.newGame(i),
          };
        }),
        { label: '← Back', action: () => ui.title() },
      ],
    });
  },

  settings(back, focus = 0) {
    const s = save.settings;
    const pct = v => `${Math.round(v * 100)}%`;
    const steps = [0, 0.25, 0.5, 0.7, 0.9, 1];
    const cycle = v => steps[(steps.findIndex(x => x >= v - 0.001) + 1) % steps.length];
    const set = (fn, i) => { fn(); applySettings(); writeSave(save); ui.settings(back, i); };
    menu({
      title: 'Settings',
      back,
      focus,
      buttons: [
        { label: `♪ Music: ${pct(s.music)}`, alt: true, wide: true, action: i => set(() => { s.music = cycle(s.music); }, i) },
        { label: `🔊 Sound: ${pct(s.sfx)}`, alt: true, wide: true, action: i => set(() => { s.sfx = cycle(s.sfx); }, i) },
        { label: `〰 Screen shake & rumble: ${s.shake ? 'On' : 'Off'}`, alt: true, wide: true, action: i => set(() => { s.shake = !s.shake; }, i) },
        { label: '← Back', action: back },
      ],
    });
  },

  pauseMenu() {
    menu({
      title: 'Paused',
      text: `${game.level.def.name} · Score ${game.score} · ◆ ${game.stats.gems}/${game.stats.gemsTotal}`,
      back: () => game.togglePause(),
      buttons: [
        { label: 'Resume', action: () => game.togglePause() },
        { label: 'Restart page', alt: true, action: () => { game.resumePlay(); game.kill(true); } },
        { label: 'Settings', alt: true, action: () => ui.settings(() => ui.pauseMenu()) },
        { label: 'Quit to title', alt: true, action: () => game.toTitle() },
      ],
    });
  },

  results(r) {
    const outcome = recordPage(save, r.index, { score: r.score, stars: r.stars, gems: r.gems, time: r.time }, LEVELS.length);
    const card = document.createElement('div');
    card.className = 'results';
    const stars = document.createElement('div');
    stars.className = 'rstars';
    const labels = ['cleared', r.gems >= r.gemsTotal ? 'every gem' : `gems ${r.gems}/${r.gemsTotal}`, r.time <= r.par ? 'under par' : `par ${fmtTime(r.par)}`];
    const earned = [true, r.gems >= r.gemsTotal, r.time <= r.par];
    earned.forEach((on, i) => {
      const s = document.createElement('span');
      s.className = 'rstar' + (on ? ' on' : '');
      s.innerHTML = `<b>${on ? '★' : '☆'}</b><small></small>`;
      s.querySelector('small').textContent = labels[i];
      s.style.animationDelay = `${0.25 + i * 0.28}s`;
      stars.append(s);
      if (on) setTimeout(() => sfx.rating(i), 250 + i * 280);
    });
    const rows = [
      ['Time', `${fmtTime(r.time)}  (par ${fmtTime(r.par)})`],
      ['Gems', `${r.gems} / ${r.gemsTotal}`],
      ['Times rubbed out', `${r.deaths ? r.deaths + ' time' + (r.deaths > 1 ? 's' : '') : 'never'}`],
      ['Door', `+${r.bonuses.door}`],
      ...(r.bonuses.time ? [['Speed bonus', `+${r.bonuses.time}`]] : []),
      ...(r.bonuses.gems ? [['All gems bonus', `+${r.bonuses.gems}`]] : []),
      ...(r.bonuses.fuel ? [['Leftover fuel', `+${r.bonuses.fuel}`]] : []),
    ];
    const table = document.createElement('dl');
    for (const [k, v] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      table.append(dt, dd);
    }
    const total = document.createElement('div');
    total.className = 'rtotal';
    total.textContent = `Page score ${r.score}` + (outcome.newBest ? '  · NEW BEST!' : '');
    card.append(stars, table, total);
    menu({
      title: 'Page cleared!',
      extra: card,
      back: () => game.toTitle(),
      buttons: [
        { label: r.last ? 'Finish ★' : 'Next page →', action: () => game.nextPage() },
        { label: 'Replay page', alt: true, action: () => game.replayPage() },
        { label: 'Title', alt: true, action: () => game.toTitle() },
      ],
    });
  },

  gameOver({ page, score, canContinue }) {
    menu({
      title: 'Rubbed out!',
      text: `Pip got erased on ${page}. Score: ${score}.`,
      back: () => game.toTitle(),
      buttons: [
        { label: 'Try this page again', action: () => game.retry() },
        ...(canContinue ? [{ label: '▶ Watch ad: +1 life', alt: true, action: () => game.watchForLife() }] : []),
        { label: 'Title', alt: true, action: () => game.toTitle() },
      ],
    });
  },

  win({ score }) {
    music.setIntensity(2);
    menu({
      title: 'Off the page!',
      text: `Pip made it through every page. Final score: ${score}. Stars: ${totalStars()} / ${LEVELS.length * 3}.`,
      back: () => game.toTitle(),
      buttons: [
        { label: 'Play again', action: () => game.afterAd(() => game.newGame(0)) },
        { label: 'Pages', alt: true, action: () => ui.pages() },
      ],
    });
  },
};

const game = new Game($('game'), ui, device);
window.game = game; // handy for poking at things from the console
game.touch = new TouchControls(game, $('touch'));
game.pads = new Gamepads(game, ui);

function applySettings() {
  const s = save.settings;
  setVolumes({ music: s.music, sfx: s.sfx });
  game.settings.shake = s.shake;
  game.pads.enabled = s.shake;
}
// Respect the OS "reduce motion" switch the first time the game runs.
if (!localStorageHas() && matchMedia('(prefers-reduced-motion: reduce)').matches) save.settings.shake = false;
applySettings();

function localStorageHas() { try { return !!localStorage.getItem('doodle-dash.save'); } catch { return false; } }

// Audio can only start from a user gesture (iOS Safari, Android Chrome, TV browsers).
for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) {
  window.addEventListener(ev, unlockAudio, { capture: true, passive: true });
}

// iOS Safari: block pinch-zoom and rubber-band scrolling during play.
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (!e.target.closest?.('#overlay')) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

// Full screen (Android, iPad, desktop). iPhone Safari has no element fullscreen: use "Add to Home Screen".
const fsTarget = document.documentElement;
const canFs = !!(fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen) && !device.tv
  && !matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
$('ov-fs').addEventListener('click', async () => {
  try {
    await (fsTarget.requestFullscreen?.({ navigationUI: 'hide' }) ?? fsTarget.webkitRequestFullscreen?.());
    await screen.orientation?.lock?.('landscape');
  } catch { /* not allowed here; the game still works */ }
});
document.addEventListener('fullscreenchange', () => $('ov-fs').classList.toggle('hidden', !!document.fullscreenElement || !canFs || !device.touch || !body.classList.contains('home')));

// Web portals (Poki, CrazyGames) don't allow links that leave the game.
if (!platform.allowExternalLinks) {
  const a = document.querySelector('#credits a');
  a.replaceWith(a.textContent);
}
// Desktop app (Tauri): F11 / Alt+Enter toggles full screen; links leave via the Rust navigation hook.
if (platform.name === 'exe') {
  document.querySelector('#credits a')?.removeAttribute('target');
  window.addEventListener('keydown', async e => {
    if (e.key !== 'F11' && !(e.altKey && e.key === 'Enter')) return;
    e.preventDefault();
    try {
      const win = window.__TAURI__.window.getCurrentWindow();
      await win.setFullscreen(!(await win.isFullscreen()));
    } catch (err) { console.warn('Full screen toggle failed', err); }
  }, true);
}
platform.setAudioHooks({ mute: () => setMuted(true), unmute: () => setMuted(false) });

Promise.all([game.loadModels(), platform.init()]).then(() => {
  platform.loadingDone();
  $('loading').classList.add('hidden');
  game.showcase(0);
  music.play(0);
  ui.title();
  // Dev shortcut: ?level=3 jumps straight into that page.
  const jump = Number(new URLSearchParams(location.search).get('level'));
  if (jump >= 1 && jump <= LEVELS.length) game.newGame(jump - 1);
});

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  game.update(dt);
  game.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

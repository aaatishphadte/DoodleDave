import { Game } from './game.js';
import { LEVELS } from './levels.js';
import { unlockAudio } from './audio.js';
import { device, TouchControls, Gamepads } from './input.js';

const $ = id => document.getElementById(id);
const body = document.body;
let actions = [null, null];
let bannerTimer = 0;
let lastHud = '';

if (device.touch) body.classList.add('touch');
if (device.tv) body.classList.add('tv');
if (device.mobile && Math.min(screen.width, screen.height) < 600) body.classList.add('phone');

$('device-tip').textContent = device.tv
  ? 'Remote: arrows to move, OK to jump. A game controller works too.'
  : device.touch
    ? 'Left thumb moves, right thumb looks. Tip: add to your home screen to play full screen.'
    : 'Keyboard + mouse, or plug in a controller.';

const visibleButtons = () => [...$('ov-buttons').querySelectorAll('button:not(.hidden)')];

const ui = {
  button: $('ov-btn'),
  overlay(title, text, label, action, label2, action2) {
    $('overlay').classList.toggle('hidden', !title);
    body.classList.toggle('playing', !title);
    if (!title) { document.activeElement?.blur?.(); return; }
    $('ov-title').textContent = title;
    $('ov-text').textContent = text;
    $('ov-btn').textContent = label;
    $('ov-btn2').textContent = label2 || '';
    $('ov-btn2').classList.toggle('hidden', !label2);
    actions = [action, action2];
    // focus the main button so TV remotes / controllers can press OK straight away
    requestAnimationFrame(() => $('ov-btn').focus({ preventScroll: true }));
  },
  moveFocus(dir) {
    const list = visibleButtons();
    const i = list.indexOf(document.activeElement);
    list[(i + dir + list.length) % list.length]?.focus({ preventScroll: true });
  },
  activate() {
    const list = visibleButtons();
    (list.includes(document.activeElement) ? document.activeElement : list[0])?.click();
  },
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
    el.style.opacity = 1;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { el.style.opacity = 0; }, 2600);
  },
  hud(game) {
    const p = game.p;
    const key = [game.score, game.lives, game.index, p.star, p.ink, Math.ceil(p.fuel)].join('|');
    if (key === lastHud) return;
    lastHud = key;
    $('score').textContent = game.score;
    $('lives').textContent = '♥'.repeat(Math.max(0, game.lives));
    $('lvl').textContent = `Page ${game.index + 1} / ${LEVELS.length}`;
    $('star').textContent = p.star ? '★ go to the door!' : '☆ find the Ink Star';
    $('ink').style.display = p.ink ? '' : 'none';
    $('fuelwrap').style.display = p.fuel > 0 ? 'flex' : 'none';
    $('fuel').style.width = p.fuel + '%';
    $('t-ink').classList.toggle('off', !p.ink);
    $('t-rocket').classList.toggle('off', !(p.fuel > 0));
  },
};

const game = new Game($('game'), ui, device);
window.game = game; // handy for poking at things from the console
game.touch = new TouchControls(game, $('touch'));
game.pads = new Gamepads(game, ui);

actions = [() => game.newGame(0), null];
$('ov-btn').addEventListener('click', () => actions[0]?.());
$('ov-btn2').addEventListener('click', () => actions[1]?.());

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
if (canFs && device.touch) $('ov-fs').classList.remove('hidden');
$('ov-fs').addEventListener('click', async () => {
  try {
    await (fsTarget.requestFullscreen?.({ navigationUI: 'hide' }) ?? fsTarget.webkitRequestFullscreen?.());
    await screen.orientation?.lock?.('landscape');
  } catch { /* not allowed here; the game still works */ }
});
document.addEventListener('fullscreenchange', () => $('ov-fs').classList.toggle('hidden', !!document.fullscreenElement || !canFs || !device.touch));

ui.button.disabled = true;
game.loadModels().then(() => {
  ui.button.disabled = false;
  ui.button.focus({ preventScroll: true });
  // Dev shortcut: ?level=3 jumps straight into that page.
  const jump = Number(new URLSearchParams(location.search).get('level'));
  if (jump >= 1 && jump <= LEVELS.length) game.newGame(jump - 1);
});

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  game.update(dt);
  game.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

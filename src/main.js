import { Game } from './game.js';
import { LEVELS } from './levels.js';

const $ = id => document.getElementById(id);
let onButton = null;
let bannerTimer = 0;
let lastHud = '';

const ui = {
  button: $('ov-btn'),
  overlay(title, text, label, action) {
    $('overlay').classList.toggle('hidden', !title);
    if (!title) return;
    $('ov-title').textContent = title;
    $('ov-text').textContent = text;
    $('ov-btn').textContent = label;
    onButton = action;
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
  },
};

const game = new Game($('game'), ui);
window.game = game; // handy for poking at things from the console
onButton = () => game.newGame(0);
ui.button.addEventListener('click', () => onButton?.());

ui.button.disabled = true;
game.loadModels().then(() => {
  ui.button.disabled = false;
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

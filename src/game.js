import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LEVELS } from './levels.js';
import { INK, boil, terrainMaterials, inked, inkModel, dot, shadowBlob, starGeometry } from './doodle.js';
import { sfx, music } from './audio.js';
import { platform } from './platform.js';

const CELL = 2;        // world units per grid cell
const RADIUS = 0.35;   // player collision radius
const STEP = 0.35;     // ledge height the player is nudged up onto
const PIT_DEPTH = -2;  // how far cliff walls extend below ground over pits

// ---- controller feel ----
// Rise is unchanged from the original tuning (the level validator's reach rules depend on it);
// the fall is heavier so jumps stop feeling floaty, with a brief apex hang for air control.
const SPEED = 7.2;
const JUMP = 12, GRAVITY = 26;
const FALL_MULT = 1.55;       // heavier on the way down
const APEX_BAND = 2.2;        // |vy| below this while holding jump = hang time
const APEX_MULT = 0.55;
const MAX_FALL = 24;          // terminal velocity
const COYOTE = 0.1, BUFFER = 0.13;
const SIM_STEP = 1 / 120;     // physics never integrates more than this per step

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const cellCenter = c => c * CELL + CELL / 2;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt); // frame-rate independent smoothing factor
const _v = V(), _w = V();

// ---------- terrain ----------

function buildTerrain(def, mats) {
  const D = def.h.length, W = def.h[0].length;
  const hAt = (x, z) => (x < 0 || z < 0 || x >= W || z >= D || def.h[z][x] === '.') ? null : +def.h[z][x];
  const maxH = Math.max(...def.h.join('').replace(/\./g, '').split('').map(Number));
  const lo = new THREE.Color(def.colors[0]), hi = new THREE.Color(def.colors[1]), tmp = new THREE.Color();
  const white = new THREE.Color(0xffffff);
  const top = { p: [], u: [], c: [] }, side = { p: [], u: [], c: [] };
  const quad = (buf, a, b, c, d, col) => {
    buf.p.push(...a, ...b, ...c, ...a, ...c, ...d);
    buf.u.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    for (let i = 0; i < 6; i++) buf.c.push(col.r, col.g, col.b);
  };
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const h = hAt(x, z);
    if (h === null) continue;
    const x0 = x * CELL, x1 = x0 + CELL, z0 = z * CELL, z1 = z0 + CELL;
    tmp.copy(lo).lerp(hi, maxH > 1 ? (h - 1) / (maxH - 1) : 0);
    quad(top, [x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], tmp);
    const shade = tmp.clone().lerp(white, 0.45);
    const wall = (nh, corners) => {
      const from = nh === null ? PIT_DEPTH : nh;
      for (let y = from; y < h; y++) quad(side, ...corners(y, y + 1), shade);
    };
    wall(hAt(x + 1, z), (a, b) => [[x1, a, z1], [x1, a, z0], [x1, b, z0], [x1, b, z1]]);
    wall(hAt(x - 1, z), (a, b) => [[x0, a, z0], [x0, a, z1], [x0, b, z1], [x0, b, z0]]);
    wall(hAt(x, z + 1), (a, b) => [[x0, a, z1], [x1, a, z1], [x1, b, z1], [x0, b, z1]]);
    wall(hAt(x, z - 1), (a, b) => [[x1, a, z0], [x0, a, z0], [x0, b, z0], [x1, b, z0]]);
  }
  const mesh = (buf, mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(buf.c, 3));
    return new THREE.Mesh(g, mat);
  };
  const group = new THREE.Group();
  group.add(mesh(top, mats.top), mesh(side, mats.side));
  return group;
}

// ---------- characters and props (procedural stand-ins; GLB models can replace them) ----------

function makeHero() {
  const g = new THREE.Group();
  const rig = new THREE.Group(); // squash & stretch is applied here so the root stays the "true" transform
  g.add(rig);
  const body = inked(new THREE.CapsuleGeometry(0.27, 0.34, 4, 10), 0xffffff);
  body.position.y = 0.66;
  const head = inked(new THREE.SphereGeometry(0.34, 14, 10), 0xffffff);
  head.position.y = 1.27;
  const eyes = [];
  for (const sx of [-1, 1]) { const e = dot(0.05); e.position.set(sx * 0.13, 0.05, 0.3); head.add(e); eyes.push(e); }
  const tuft = inked(new THREE.ConeGeometry(0.11, 0.3, 8), 0xffd23f);
  tuft.position.set(0, 0.42, 0); tuft.rotation.z = -0.25; head.add(tuft);
  const scarf = inked(new THREE.TorusGeometry(0.22, 0.075, 6, 12), 0xe8443a);
  scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.98;
  const tail = inked(new THREE.BoxGeometry(0.12, 0.05, 0.42), 0xe8443a, { mode: 1, thick: 0.02 });
  tail.position.set(0.12, 0.98, -0.3);
  const limb = (x, y, len) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = inked(new THREE.CylinderGeometry(0.065, 0.065, len, 6), 0xffffff, { thick: 0.035 });
    m.position.y = -len / 2;
    pivot.add(m);
    return pivot;
  };
  const legs = [limb(-0.13, 0.38, 0.38), limb(0.13, 0.38, 0.38)];
  const arms = [limb(-0.34, 0.9, 0.36), limb(0.34, 0.9, 0.36)];
  arms[0].rotation.z = -0.35; arms[1].rotation.z = 0.35;
  const rocket = makeRocket();
  rocket.scale.setScalar(0.7); rocket.position.set(0, 0.7, -0.33); rocket.visible = false;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 6), new THREE.MeshBasicMaterial({ color: 0xff7b2e }));
  flame.rotation.x = Math.PI; flame.position.y = -0.55; flame.visible = false;
  rocket.add(flame);
  rig.add(body, head, scarf, tail, ...legs, ...arms, rocket);
  g.userData = { rig, legs, arms, rocket, flame, body, head, eyes, tail };
  return g;
}

function makeRocket() {
  const g = new THREE.Group();
  const shaft = inked(new THREE.CylinderGeometry(0.13, 0.13, 0.6, 8), 0xffd23f);
  const tip = inked(new THREE.ConeGeometry(0.13, 0.28, 8), 0xf2c9a0);
  tip.position.y = 0.44;
  const lead = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 6), new THREE.MeshBasicMaterial({ color: INK }));
  lead.position.y = 0.55;
  const rubber = inked(new THREE.CylinderGeometry(0.135, 0.135, 0.14, 8), 0xff9fb2);
  rubber.position.y = -0.37;
  g.add(shaft, tip, lead, rubber);
  return g;
}

function makeEraser() {
  const g = new THREE.Group();
  const body = inked(new THREE.BoxGeometry(0.95, 0.6, 0.62), 0xff9fb2, { mode: 1 });
  body.position.y = 0.36;
  const band = inked(new THREE.BoxGeometry(0.3, 0.64, 0.66), 0x6fa8dc, { mode: 1, thick: 0.02 });
  band.position.set(-0.2, 0.36, 0);
  for (const sz of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    white.position.set(0.48, 0.48, sz * 0.15);
    const pupil = dot(0.05); pupil.position.x = 0.08;
    white.add(pupil);
    g.add(white);
  }
  // angry brow so it reads as a threat at a glance
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.42), new THREE.MeshBasicMaterial({ color: INK }));
  brow.position.set(0.5, 0.62, 0); brow.rotation.x = 0.15;
  g.add(body, band, brow);
  return g;
}

function makeFly() {
  const g = new THREE.Group();
  const body = inked(new THREE.SphereGeometry(0.3, 10, 8), 0x8d8fa3);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.3, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    w.position.set(0, 0.25, s * 0.3); w.rotation.x = Math.PI / 2;
    wings.push(w); g.add(w);
    const eye = dot(0.06); eye.position.set(0.24, 0.08, s * 0.12); g.add(eye);
  }
  g.add(body);
  g.userData.wings = wings;
  return g;
}

function makeSpikes() {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45], [0, 0]]) {
    const wood = inked(new THREE.ConeGeometry(0.26, 0.75, 7), 0xf2c9a0, { thick: 0.035 });
    wood.position.set(x, 0.375, z);
    const lead = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 7), new THREE.MeshBasicMaterial({ color: INK }));
    lead.position.y = 0.26;
    wood.add(lead);
    g.add(wood);
  }
  return g;
}

function makeDoor() {
  const g = new THREE.Group();
  const frame = inked(new THREE.BoxGeometry(1.5, 2.3, 0.3), 0xb98b5e, { mode: 1 });
  frame.position.y = 1.15;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.36), new THREE.MeshBasicMaterial({ color: 0x8a8d99 }));
  panel.position.y = 1.05;
  const lock = inked(starGeometry(0.3, 0.13, 0.42), 0xffffff, { mode: 2, thick: 0.03 });
  lock.position.y = 1.3;
  g.add(frame, panel, lock);
  g.userData = { panel, lock };
  return g;
}

function makeInkBottle() {
  const g = new THREE.Group();
  const jar = inked(new THREE.CylinderGeometry(0.24, 0.28, 0.42, 10), 0x2d2f4a);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.285, 0.18, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const cap = inked(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 8), 0xe8443a);
  cap.position.y = 0.29;
  g.add(jar, label, cap);
  return g;
}

// Checkpoint: a pencil flagpole with a paper flag that turns red once touched.
function makeFlag() {
  const g = new THREE.Group();
  const pole = inked(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 6), 0xffd23f, { thick: 0.03 });
  pole.position.y = 0.9;
  const tip = inked(new THREE.ConeGeometry(0.06, 0.16, 6), 0xf2c9a0, { thick: 0.02 });
  tip.position.y = 1.88;
  const pivot = new THREE.Group();
  pivot.position.y = 1.5;
  const cloth = inked(new THREE.BoxGeometry(0.7, 0.45, 0.04), 0xd6d6de, { mode: 1, thick: 0.025 });
  cloth.position.x = 0.38;
  pivot.add(cloth);
  g.add(pole, tip, pivot);
  g.userData = { cloth, pivot };
  return g;
}

let gemGeo;
const makeGem = () => inked(gemGeo ||= new THREE.OctahedronGeometry(0.3), 0x58c4f6, { mode: 2 });

// ---------- the game ----------

export class Game {
  constructor(canvas, ui, device = {}) {
    this.ui = ui;
    this.device = device;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !device.mobile || window.devicePixelRatio < 2, alpha: true, powerPreference: 'high-performance' });
    // Phones have very dense screens; rendering at full density costs a lot for little gain.
    this.maxRatio = device.tv ? 1 : device.mobile ? 1.5 : 2;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.perf = { t: 0, frames: 0 };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    this.mats = terrainMaterials();
    this.models = {};
    this.keys = {};
    this.virt = { x: 0, z: 0, rocket: false }; // analog input from touch / gamepad
    this.jumpHeld = false;
    this.autoCam = !!(device.touch || device.tv);
    this.lastLook = -10;
    this.state = 'title';
    this.time = 0;       // simulation time (stops during hit-stop and pause)
    this.realTime = 0;
    this.focus = V();
    this.lead = V();     // camera look-ahead offset
    this.camDist = 10;
    this.trauma = 0;     // screen shake, 0..1, shake amount = trauma^2
    this.freeze = 0;     // hit-stop seconds remaining
    this.settings = { shake: true };
    this.score = 0;
    this.lives = 3;

    // Shared, pooled particle meshes: no per-burst geometry allocations.
    this.fx = new THREE.Group();
    this.scene.add(this.fx);
    this.bitGeo = new THREE.SphereGeometry(1, 6, 4);
    this.bitMats = new Map();
    this.bitPool = [];
    this.bits = [];
    this.shotGeo = new THREE.SphereGeometry(0.15, 8, 6);
    this.shotMat = new THREE.MeshBasicMaterial({ color: INK });

    this.bindInput(canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.togglePause();
    });
  }

  // ----- shared input actions (keyboard, mouse, touch, gamepad, TV remote) -----

  pressJump() {
    if (this.state !== 'play') return;
    this.jumpHeld = true;
    this.p.buffer = BUFFER;
  }

  releaseJump() {
    this.jumpHeld = false;
    if (this.p && this.p.vel.y > 0 && !this.p.rocketing) this.p.vel.y *= 0.5; // short hop
  }

  look(dYaw, dPitch) {
    this.yaw -= dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, 0.12, 1.3);
    this.lastLook = this.realTime;
  }

  useAutoCam(on) { this.autoCam = on; }

  clearInput() {
    this.keys = {};
    this.virt.x = this.virt.z = 0;
    this.virt.rocket = false;
    this.jumpHeld = false;
    this.touch?.reset();
  }

  togglePause() {
    if (this.state === 'play') {
      this.state = 'pause';
      platform.gameplayStop();
      this.clearInput();
      document.exitPointerLock?.();
      this.ui.showHud(false);
      music.setMuffled(true);
      this.ui.pauseMenu();
    } else if (this.state === 'pause') {
      this.resumePlay();
    }
  }

  resumePlay() {
    this.state = 'play';
    this.ui.overlay(null);
    this.ui.showHud(true);
    music.setMuffled(false);
    platform.gameplayStart();
  }

  // Optional GLB overrides listed in public/models/manifest.json (see public/models/README.md).
  async loadModels() {
    try {
      const manifest = await (await fetch('models/manifest.json')).json();
      const loader = new GLTFLoader();
      await Promise.all(Object.entries(manifest).map(async ([slot, file]) => {
        try { this.models[slot] = inkModel((await loader.loadAsync('models/' + file)).scene); }
        catch (e) { console.warn(`Model "${slot}" (${file}) failed to load, using the built-in doodle.`, e); }
      }));
    } catch { /* no manifest: built-in doodles only */ }
  }

  make(slot, fallback) {
    return this.models[slot] ? this.models[slot].clone() : fallback();
  }

  bindInput(canvas) {
    // TV remotes send arrows + Enter (OK); Back arrives as Escape / GoBack / BrowserBack / 461 (webOS) / 10009 (Tizen).
    const isBack = e => ['Escape', 'GoBack', 'BrowserBack', 'Backspace'].includes(e.key) || e.keyCode === 461 || e.keyCode === 10009;
    const isJump = e => e.code === 'Space' || e.key === 'Enter' || e.code === 'NumpadEnter';
    window.addEventListener('keydown', e => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || e.key?.startsWith('Arrow')) e.preventDefault();
      if (this.state !== 'play') {
        if (isBack(e) && !e.repeat) { e.preventDefault(); this.ui.back(); return; }
        if (this.state === 'pause' && e.code === 'KeyP' && !e.repeat) { e.preventDefault(); this.togglePause(); return; }
        if (e.key?.startsWith('Arrow')) this.ui.moveFocus(e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1);
        else if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') this.ui.activate();
        return;
      }
      if (isBack(e) || e.code === 'KeyP') { e.preventDefault(); if (!e.repeat) this.togglePause(); return; }
      if (isJump(e)) { e.preventDefault(); if (!e.repeat) this.pressJump(); }
      if ((e.code === 'KeyF' || e.code === 'KeyJ') && !e.repeat) this.shoot();
      if (e.code === 'KeyR' && !e.repeat) this.kill(true);
      if (e.key?.startsWith('Arrow') && this.device.tv) this.autoCam = true;
      this.keys[e.code || e.key] = true;
      if (e.key?.startsWith('Arrow')) this.keys[e.key] = true; // some TV browsers leave e.code empty
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code || e.key] = false;
      if (e.key?.startsWith('Arrow')) this.keys[e.key] = false;
      if (isJump(e)) this.releaseJump();
    });
    window.addEventListener('blur', () => this.clearInput());
    let dragging = false;
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || this.state !== 'play') return;
      this.autoCam = false;
      if (document.pointerLockElement === canvas) this.shoot();
      else { dragging = true; canvas.requestPointerLock?.(); }
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', e => {
      if (this.state !== 'play' || !(dragging || document.pointerLockElement === canvas)) return;
      this.autoCam = false;
      this.look(e.movementX * 0.004, e.movementY * 0.003);
    });
    canvas.addEventListener('wheel', e => { this.dist = THREE.MathUtils.clamp(this.dist + Math.sign(e.deltaY), 6, 18); }, { passive: true });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait phones: widen the view so the level isn't a narrow slit.
    this.camera.fov = w / h < 1 ? 72 : 55;
    this.camera.updateProjectionMatrix();
  }

  // Drop render resolution if the device can't hold ~45 fps.
  adaptQuality(dt) {
    const pf = this.perf;
    if (this.realTime < 3) return; // skip start-up shader compiles
    pf.t += dt; pf.frames++;
    if (pf.t < 2) return;
    const fps = pf.frames / pf.t;
    pf.t = 0; pf.frames = 0;
    if (fps < 45 && this.pixelRatio > 0.75) {
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    }
  }

  // ----- juice -----

  shake(amount) { if (this.settings.shake) this.trauma = Math.min(1, this.trauma + amount); }
  hitStop(seconds) { this.freeze = Math.max(this.freeze, seconds); }
  rumble(strong, weak, ms) { this.pads?.rumble(strong, weak, ms); }

  popup(at, text, kind = '') {
    _v.copy(at).project(this.camera);
    if (_v.z > 1) return;
    this.ui.popup((_v.x + 1) / 2 * window.innerWidth, (1 - _v.y) / 2 * window.innerHeight, text, kind);
  }

  bitMat(color) {
    if (!this.bitMats.has(color)) this.bitMats.set(color, new THREE.MeshBasicMaterial({ color }));
    return this.bitMats.get(color);
  }

  burst(at, color, count = 8, { speed = 6, up = 2, rise = 4, size = 0.09, life = 0.55, grav = 14 } = {}) {
    for (let i = 0; i < count; i++) {
      const mesh = this.bitPool.pop() || new THREE.Mesh(this.bitGeo);
      mesh.material = this.bitMat(color);
      mesh.position.copy(at);
      const s = size * (0.7 + Math.random() * 0.6);
      mesh.scale.setScalar(s);
      this.fx.add(mesh);
      this.bits.push({
        mesh, size: s, life, max: life, grav,
        vel: V((Math.random() - 0.5) * speed, up + Math.random() * rise, (Math.random() - 0.5) * speed),
      });
    }
  }

  // Ring of paper puffs at the feet (landing, jumping, running).
  dust(at, count = 6, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const mesh = this.bitPool.pop() || new THREE.Mesh(this.bitGeo);
      mesh.material = this.bitMat(0xfffdf6);
      mesh.position.set(at.x + Math.cos(a) * 0.25, at.y + 0.08, at.z + Math.sin(a) * 0.25);
      const s = 0.1 + Math.random() * 0.06 * power;
      mesh.scale.setScalar(s);
      this.fx.add(mesh);
      this.bits.push({ mesh, size: s, life: 0.35, max: 0.35, grav: -2, vel: V(Math.cos(a) * 2.6 * power, 0.6, Math.sin(a) * 2.6 * power) });
    }
  }

  updateBits(dt) {
    for (const b of this.bits) {
      b.life -= dt;
      b.vel.y -= b.grav * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.scale.setScalar(b.size * Math.max(0.05, b.life / b.max));
      if (b.life <= 0) { this.fx.remove(b.mesh); this.bitPool.push(b.mesh); }
    }
    this.bits = this.bits.filter(b => b.life > 0);
  }

  clearBits() {
    for (const b of this.bits) { this.fx.remove(b.mesh); this.bitPool.push(b.mesh); }
    this.bits = [];
  }

  // ----- flow -----

  // Title backdrop: a page with the camera slowly orbiting it.
  showcase(index = 0) {
    this.loadLevel(index, { quiet: true });
    this.state = 'title';
    this.yaw = -Math.PI * 0.7;
    this.pitch = 0.75;
    this.dist = 15;
    const c = V(this.level.w * CELL / 2, 1, this.level.d * CELL / 2);
    this.showcaseCenter = c;
    this.focus.copy(c);
    this.placeCamera(1, true);
  }

  newGame(levelIndex = 0) {
    this.clearInput();
    this.score = 0;
    this.lives = 3;
    this.loadLevel(levelIndex);
    this.startPlay();
  }

  startPlay() {
    this.state = 'play';
    this.ui.showHud(true);
    this.ui.overlay(null);
    music.setMuffled(false);
    platform.gameplayStart();
  }

  toTitle() {
    this.state = 'title';
    platform.gameplayStop();
    this.clearInput();
    document.exitPointerLock?.();
    this.ui.showHud(false);
    this.showcase(this.index ?? 0);
    music.play(0);
    music.setMuffled(false);
    this.ui.title();
  }

  // Portal builds show an ad first; elsewhere this just runs the action.
  async afterAd(action) {
    if (platform.hasAds) {
      this.state = 'ad';
      this.ui.overlay(null);
      this.ui.showHud(false);
      await platform.midgameAd();
    }
    action();
  }

  loadLevel(index, { quiet = false } = {}) {
    if (this.level) {
      this.scene.remove(this.level.group);
      this.level.group.traverse(o => { if (o.isMesh && o.geometry.attributes.color) o.geometry.dispose(); });
    }
    this.clearBits();
    const def = LEVELS[index];
    const L = this.level = {
      def, group: new THREE.Group(), w: def.h[0].length, d: def.h.length,
      ents: [], platforms: [], shots: [], flags: [],
    };
    this.index = index;
    this.scene.add(L.group);
    L.group.add(buildTerrain(def, this.mats));

    if (!this.hero) {
      this.hero = this.make('hero', makeHero);
      this.heroShadow = shadowBlob(1.1);
      this.scene.add(this.hero, this.heroShadow);
    }

    const add = (type, mesh, cx, cz, lift = 0, extra = {}) => {
      const h = +def.h[cz][cx];
      mesh.position.set(cellCenter(cx), h + lift, cellCenter(cz));
      L.group.add(mesh);
      const e = { type, mesh, alive: true, home: mesh.position.clone(), baseH: h, cx, cz, ...extra };
      L.ents.push(e);
      return e;
    };
    let gems = 0;
    for (let cz = 0; cz < L.d; cz++) for (let cx = 0; cx < L.w; cx++) {
      const ch = def.o[cz][cx];
      if (ch === 'P') this.start = V(cellCenter(cx), +def.h[cz][cx], cellCenter(cz));
      else if (ch === 'o') { add('gem', this.make('gem', makeGem), cx, cz, 0.8); gems++; }
      else if (ch === 'S') add('star', this.make('star', () => inked(starGeometry(), 0xffd23f, { mode: 2 })), cx, cz, 1.1);
      else if (ch === 'E') L.exit = add('exit', this.make('exit', makeDoor), cx, cz);
      else if (ch === '^') add('spikes', makeSpikes(), cx, cz);
      else if (ch === 'm' || ch === 'M') add('eraser', this.make('eraser', makeEraser), cx, cz, 0, { axis: ch === 'm' ? 'x' : 'z', dir: 1, squash: 0 });
      else if (ch === 'b') add('fly', this.make('fly', makeFly), cx, cz, 1.4, { angle: Math.random() * 6 });
      else if (ch === 'R') add('rocket', makeRocket(), cx, cz, 0.9);
      else if (ch === 'I') add('ink', makeInkBottle(), cx, cz, 0.7);
      else if (ch === 'C') L.flags.push(add('flag', makeFlag(), cx, cz, 0, { on: false }));
    }
    for (const pd of def.platforms) {
      const mesh = inked(new THREE.BoxGeometry(CELL - 0.1, 0.3, CELL - 0.1), 0xffe45c, { mode: 1 });
      const a = V(cellCenter(pd.from[0]), pd.from[1] - 0.15, cellCenter(pd.from[2]));
      const b = V(cellCenter(pd.to[0]), pd.to[1] - 0.15, cellCenter(pd.to[2]));
      mesh.position.copy(a);
      L.group.add(mesh);
      L.platforms.push({ mesh, a, b, period: pd.period, delta: V() });
    }

    this.p = {
      pos: this.start.clone(), vel: V(), ground: true, coyote: 0, buffer: 0, face: Math.PI / 2,
      fuel: 0, ink: false, star: false, dead: 0, cool: 0, plat: null, walk: 0, safe: 0,
      sq: 0, sqv: 0, airTime: 0, peakFall: 0, stepPhase: 0, rocketSfx: 0,
    };
    this.checkpoint = null;
    this.pageScore = this.score;
    this.stats = { gems: 0, gemsTotal: gems, deaths: 0, kills: 0, time: 0 };
    this.trauma = 0;
    this.freeze = 0;
    this.yaw = -Math.PI / 2;
    this.pitch = 0.55;
    this.dist = 10;
    this.focus.copy(this.start);
    this.lead.set(0, 0, 0);
    this.hero.visible = true;
    this.hero.scale.setScalar(1);
    this.hero.position.copy(this.start);
    this.placeCamera(1, true);
    if (!quiet) {
      this.ui.wipe?.();
      this.ui.banner(def.name, def.hint);
      music.play(index + 1);
    }
    this.ui.hud(this);
  }

  kill(force = false) {
    const p = this.p;
    if (p.dead > 0 || (!force && p.safe > 0) || this.state !== 'play') return;
    p.dead = 0.8;
    this.stats.deaths++;
    sfx.die();
    navigator.vibrate?.([60, 40, 120]);
    this.rumble(0.9, 0.6, 260);
    this.hitStop(0.12);
    this.shake(0.55);
    this.burst(_w.copy(p.pos).setY(p.pos.y + 0.8), 0xe8443a, 14, { speed: 8 });
    this.burst(_w, 0xffffff, 8, { speed: 5, size: 0.12 });
  }

  afterDeath() {
    this.lives--;
    if (this.lives <= 0) {
      this.state = 'over';
      platform.gameplayStop();
      this.clearInput();
      this.ui.showHud(false);
      music.setMuffled(true);
      const canContinue = platform.hasRewarded && !this.level.continued;
      this.ui.gameOver({ page: this.level.def.name, score: this.score, canContinue });
      return;
    }
    this.respawn();
  }

  retry() { this.afterAd(() => this.newGame(this.index)); }

  // Rewarded ad: one extra life, keep the score and stay on this page (once per page).
  async watchForLife() {
    this.state = 'ad';
    this.ui.overlay(null);
    const ok = await platform.rewardedAd();
    if (!ok) { this.lives = 1; this.afterDeath(); return; } // back to the game-over screen
    this.level.continued = true;
    this.lives = 1;
    this.startPlay();
    this.respawn();
    this.ui.banner('Extra life!', 'Back you go.');
  }

  respawn() {
    const p = this.p;
    p.pos.copy(this.checkpoint || this.start);
    p.vel.set(0, 0, 0);
    p.dead = 0;
    p.safe = 1.5;
    p.plat = null;
    p.sq = 0; p.sqv = 0;
    this.hero.scale.setScalar(1);
    this.hero.rotation.y = p.face;
    this.focus.copy(p.pos);
    this.placeCamera(1, true); // intentional hard cut, no whip across the level
    this.ui.hud(this);
  }

  // Door reached: Pip hops into the door, then the results card appears.
  finishLevel() {
    const p = this.p, def = this.level.def, st = this.stats;
    sfx.door();
    this.shake(0.25);
    this.rumble(0.4, 0.8, 200);
    this.burst(_w.copy(this.level.exit.mesh.position).setY(this.level.exit.mesh.position.y + 1.2), 0xffd23f, 18, { speed: 7 });
    const par = def.par ?? 60;
    const allGems = st.gems >= st.gemsTotal;
    const underPar = st.time <= par;
    const timeBonus = Math.max(0, Math.round((par - st.time) * 20));
    const fuelBonus = Math.round(p.fuel) * 5;
    const gemBonus = allGems && st.gemsTotal ? 1000 : 0;
    this.score += 1000 + timeBonus + fuelBonus + gemBonus;
    this.result = {
      index: this.index, name: def.name, last: this.index + 1 >= LEVELS.length,
      score: this.score - this.pageScore, total: this.score,
      gems: st.gems, gemsTotal: st.gemsTotal, time: st.time, par, deaths: st.deaths,
      bonuses: { door: 1000, time: timeBonus, fuel: fuelBonus, gems: gemBonus },
      stars: 1 + (allGems ? 1 : 0) + (underPar ? 1 : 0),
    };
    this.clearInput();
    this.state = 'exiting';
    this.exitT = 0.7;
    this.exitFrom = p.pos.clone();
    platform.gameplayStop();
  }

  nextPage() {
    const r = this.result;
    if (r.last) {
      this.state = 'win';
      document.exitPointerLock?.();
      this.ui.win({ score: this.score });
      return;
    }
    this.afterAd(() => { this.loadLevel(r.index + 1); this.startPlay(); });
  }

  replayPage() {
    this.score = this.pageScore;
    this.afterAd(() => { this.loadLevel(this.index); this.startPlay(); });
  }

  // ----- world queries -----

  groundH(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), L = this.level;
    if (cx < 0 || cz < 0 || cx >= L.w || cz >= L.d) return -Infinity;
    const c = L.def.h[cz][cx];
    return c === '.' ? -Infinity : +c;
  }

  blocked(x, z, y) {
    for (const sx of [-RADIUS, RADIUS]) for (const sz of [-RADIUS, RADIUS]) {
      if (this.groundH(x + sx, z + sz) > y + STEP) return true;
    }
    return false;
  }

  floorUnder(x, z, y, r = RADIUS * 0.8) {
    let best = -Infinity;
    for (const [sx, sz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r]]) {
      const h = this.groundH(x + sx, z + sz);
      if (h <= y + STEP && h > best) best = h;
    }
    return best;
  }

  // ----- actions -----

  shoot() {
    const p = this.p;
    if (this.state !== 'play' || !p.ink || p.cool > 0 || p.dead > 0) return;
    p.cool = 0.3;
    sfx.shoot();
    p.sq = -0.15; // tiny recoil squash
    const mesh = new THREE.Mesh(this.shotGeo, this.shotMat);
    mesh.position.set(p.pos.x + Math.sin(p.face) * 0.4, p.pos.y + 0.85, p.pos.z + Math.cos(p.face) * 0.4);
    this.level.group.add(mesh);
    this.level.shots.push({ mesh, vel: V(Math.sin(p.face) * 18, 0, Math.cos(p.face) * 18), life: 1.1, trail: 0 });
  }

  // TV remote has no fire button: ink fires by itself at an enemy straight ahead.
  autoInk() {
    const p = this.p;
    if (!p.ink || p.cool > 0 || p.dead > 0) return;
    const fx = Math.sin(p.face), fz = Math.cos(p.face);
    for (const e of this.level.ents) {
      if (!e.alive || (e.type !== 'eraser' && e.type !== 'fly')) continue;
      const dx = e.mesh.position.x - p.pos.x, dz = e.mesh.position.z - p.pos.z, d = Math.hypot(dx, dz);
      const dy = e.mesh.position.y + (e.type === 'eraser' ? 0.4 : 0) - (p.pos.y + 0.85);
      if (d < 9 && d > 0.5 && Math.abs(dy) < 0.8 && (dx * fx + dz * fz) / d > 0.96) { this.shoot(); return; }
    }
  }

  // An enemy defeated by ink or by a stomp.
  defeat(e, at, how) {
    e.alive = false; e.mesh.visible = false;
    const pts = how === 'stomp' ? 200 : 300;
    this.score += pts;
    this.stats.kills++;
    this.hitStop(0.06);
    this.shake(0.22);
    this.rumble(0.5, 0.3, 120);
    this.burst(at, INK, 12, { speed: 7 });
    this.burst(at, e.type === 'eraser' ? 0xff9fb2 : 0x8d8fa3, 8, { speed: 6, size: 0.12 });
    this.popup(at, '+' + pts);
  }

  // ----- update -----

  update(dt) {
    this.realTime += dt;
    boil.value = Math.floor(this.realTime * 7);
    this.pads?.poll(dt);

    if (this.state === 'exiting') this.updateExit(dt);
    if (this.state !== 'play') {
      if (this.state === 'title' && this.level) this.yaw += dt * 0.12;
      if (this.level) { this.updateBits(dt); this.idleScene(dt); this.placeCamera(dt); }
      return;
    }
    this.adaptQuality(dt);
    const k = this.keys;
    const turn = (k.KeyQ ? 1 : 0) - (k.KeyE ? 1 : 0);
    if (turn) this.look(-turn * 2.2 * dt, 0);
    if (this.device.tv) this.autoInk();

    // Hit-stop: the world freezes for a few frames; input still buffers in the meantime.
    let sim = dt;
    if (this.freeze > 0) { const f = Math.min(this.freeze, sim); this.freeze -= f; sim -= f; }
    // Sub-step so jump arcs and collisions are the same at 30, 60 or 144 fps.
    const n = Math.ceil(sim / SIM_STEP - 1e-6);
    for (let i = 0; i < n && this.state === 'play'; i++) this.step(sim / n);

    this.placeCamera(dt);
    this.ui.hud(this);
  }

  step(h) {
    this.time += h;
    this.stats.time += h;
    for (const pl of this.level.platforms) {
      const t = 0.5 - 0.5 * Math.cos((this.time / pl.period) * Math.PI * 2);
      _v.copy(pl.mesh.position);
      pl.mesh.position.lerpVectors(pl.a, pl.b, t);
      pl.delta.subVectors(pl.mesh.position, _v);
    }
    this.updatePlayer(h);
    if (this.state !== 'play') return;
    this.updateEntities(h);
    if (this.state !== 'play') return;
    this.updateShots(h);
    this.updateBits(h);
  }

  // Menus / title: keep pickups spinning and the hero breathing so the page never looks frozen.
  idleScene(dt) {
    for (const e of this.level.ents) {
      if (!e.alive) continue;
      if (e.type === 'gem' || e.type === 'star' || e.type === 'rocket' || e.type === 'ink') {
        e.mesh.rotation.y += dt * 2;
        e.mesh.position.y = e.home.y + Math.sin(this.realTime * 3 + e.cx) * 0.12;
      }
    }
    const parts = this.hero.userData;
    if (parts.head && this.state === 'title') parts.head.position.y = 1.27 + Math.sin(this.realTime * 2.4) * 0.025;
  }

  updateExit(dt) {
    this.exitT -= dt;
    const door = this.level.exit.mesh.position, t = 1 - Math.max(0, this.exitT) / 0.7;
    const e = t * t * (3 - 2 * t);
    this.hero.position.lerpVectors(this.exitFrom, door, e);
    this.hero.position.y += Math.sin(t * Math.PI) * 1.2;
    this.hero.scale.setScalar(Math.max(0.01, 1 - e));
    this.hero.rotation.y += dt * 10;
    this.level.exit.mesh.userData.lock && (this.level.exit.mesh.userData.lock.rotation.z += dt * 12);
    this.updateBits(dt);
    if (this.exitT <= 0) {
      this.state = 'results';
      this.hero.visible = false;
      this.ui.showHud(false);
      this.ui.results(this.result);
    }
  }

  updatePlayer(dt) {
    const p = this.p, k = this.keys, hero = this.hero, parts = hero.userData;
    if (p.dead > 0) {
      p.dead -= dt;
      hero.scale.setScalar(Math.max(0.01, p.dead / 0.8));
      hero.rotation.y += dt * 16;
      if (p.dead <= 0) this.afterDeath();
      return;
    }
    p.safe -= dt;
    p.cool -= dt;
    if (p.plat) p.pos.add(p.plat.delta);

    const ix = THREE.MathUtils.clamp((k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + this.virt.x, -1, 1);
    const iz = THREE.MathUtils.clamp((k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) + this.virt.z, -1, 1);
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    let mx = -s * iz + c * ix, mz = -c * iz - s * ix;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; } // analog sticks keep partial speed
    if (len > 0.05) p.face = Math.atan2(mx, mz);

    // Auto camera (touch / gamepad / TV): drift behind the player while they run,
    // unless they've turned the camera themselves in the last moment.
    if (this.autoCam && len > 0.3 && this.realTime - this.lastLook > 1.2) {
      const diff = Math.atan2(Math.sin(p.face + Math.PI - this.yaw), Math.cos(p.face + Math.PI - this.yaw));
      this.yaw += Math.sin(diff) * Math.min(1, len) * 1.4 * dt; // sin() so running toward the camera doesn't flip it
    }
    // Snappy on the ground, a bit of drift in the air; turning around brakes harder than accelerating.
    const wx = mx * SPEED, wz = mz * SPEED;
    const reversing = wx * p.vel.x + wz * p.vel.z < 0;
    const grip = damp(p.ground ? (reversing ? 22 : 16) : 7, dt);
    p.vel.x += (wx - p.vel.x) * grip;
    p.vel.z += (wz - p.vel.z) * grip;

    const wasGround = p.ground;
    const fallSpeed = -p.vel.y;
    p.coyote = p.ground ? COYOTE : p.coyote - dt;
    p.buffer -= dt;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vel.y = JUMP; p.buffer = 0; p.coyote = 0; p.ground = false; p.plat = null;
      p.sq = -0.55; p.sqv = 0; // stretch on take-off
      sfx.jump();
      this.dust(p.pos, 5, 0.7);
    }
    // TV remotes have no spare button: holding OK while falling fires the rocket.
    const remoteRocket = this.device.tv && this.jumpHeld && !p.ground && p.vel.y < 0;
    const rocketing = p.rocketing = (k.ShiftLeft || k.ShiftRight || this.virt.rocket || remoteRocket) && p.fuel > 0;
    if (rocketing) {
      p.vel.y += (7 - p.vel.y) * damp(8, dt);
      p.fuel = Math.max(0, p.fuel - 14 * dt);
      p.ground = false; p.plat = null;
      p.rocketSfx -= dt;
      if (p.rocketSfx <= 0) { p.rocketSfx = 0.09; sfx.rocket(); this.burst(_w.set(p.pos.x - Math.sin(p.face) * 0.3, p.pos.y + 0.2, p.pos.z - Math.cos(p.face) * 0.3), 0xff7b2e, 1, { speed: 1, up: -3, rise: 0, size: 0.08, life: 0.3, grav: 0 }); }
    } else {
      let g = GRAVITY;
      if (this.jumpHeld && Math.abs(p.vel.y) < APEX_BAND && !p.ground) g *= APEX_MULT;
      else if (p.vel.y < 0) g *= FALL_MULT;
      p.vel.y = Math.max(p.vel.y - g * dt, -MAX_FALL);
    }

    const nx = p.pos.x + p.vel.x * dt;
    if (!this.blocked(nx, p.pos.z, p.pos.y)) p.pos.x = nx; else p.vel.x = 0;
    const nz = p.pos.z + p.vel.z * dt;
    if (!this.blocked(p.pos.x, nz, p.pos.y)) p.pos.z = nz; else p.vel.z = 0;

    const prevY = p.pos.y;
    let ny = prevY + p.vel.y * dt;
    let floor = this.floorUnder(p.pos.x, p.pos.z, prevY), plat = null;
    for (const pl of this.level.platforms) {
      const top = pl.mesh.position.y + 0.15, half = CELL / 2 + RADIUS * 0.6;
      if (Math.abs(p.pos.x - pl.mesh.position.x) < half && Math.abs(p.pos.z - pl.mesh.position.z) < half
        && prevY >= top - 0.45 && top > floor) { floor = top; plat = pl; }
    }
    if (p.vel.y <= 0 && ny <= floor) { ny = floor; p.vel.y = 0; p.ground = true; p.plat = plat; }
    else { p.ground = false; p.plat = null; }
    p.pos.y = ny;
    if (ny < -12) this.kill(true);

    // landing: squash + dust + thud scaled by impact speed
    if (p.ground && !wasGround && fallSpeed > 4) {
      const hard = THREE.MathUtils.clamp((fallSpeed - 4) / 18, 0, 1);
      p.sq = 0.25 + hard * 0.45; p.sqv = 0;
      sfx.land(hard);
      this.dust(p.pos, 6 + Math.round(hard * 6), 0.6 + hard);
      if (hard > 0.55) { this.shake(0.12 * hard); this.rumble(0.3 * hard, 0.2, 90); }
    }

    // pose
    hero.position.copy(p.pos);
    let turn = p.face - hero.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    hero.rotation.y += turn * damp(16, dt);
    hero.visible = p.safe <= 0 || Math.floor(this.time * 14) % 2 === 0;
    const speed = Math.hypot(p.vel.x, p.vel.z);

    // squash spring: critically-damped-ish return to rest (juice must settle)
    p.sqv += (-320 * p.sq - 20 * p.sqv) * dt;
    p.sq += p.sqv * dt;

    if (parts.legs) {
      const prevWalk = p.walk;
      p.walk += speed * dt * 2.2;
      if (p.ground && speed > 2.5 && Math.floor(p.walk / Math.PI) !== Math.floor(prevWalk / Math.PI)) {
        sfx.step();
        if (Math.random() < 0.5) this.dust(p.pos, 2, 0.35);
      }
      const swing = p.ground ? Math.sin(p.walk) * Math.min(1, speed / 3) * 0.9 : 0.5;
      parts.legs[0].rotation.x = swing; parts.legs[1].rotation.x = -swing;
      parts.arms[0].rotation.x = -swing; parts.arms[1].rotation.x = swing;
      // arms flail up while airborne
      const airArms = p.ground ? 0.35 : 0.35 + THREE.MathUtils.clamp(p.vel.y * 0.08, -0.2, 0.9);
      parts.arms[0].rotation.z = -airArms; parts.arms[1].rotation.z = airArms;
      const vStretch = p.ground ? 0 : THREE.MathUtils.clamp(p.vel.y * 0.012, -0.1, 0.14);
      const sy = 1 - p.sq * 0.4 + vStretch;
      const sxz = 1 / Math.sqrt(Math.max(0.3, sy)); // conserve volume
      parts.rig.scale.set(sxz, sy, sxz);
      // lean into the run
      parts.rig.rotation.x = THREE.MathUtils.clamp(speed / SPEED, 0, 1) * 0.12;
      // idle breathing + blink
      parts.head.position.y = 1.27 + (speed < 0.5 && p.ground ? Math.sin(this.time * 2.4) * 0.025 : 0);
      const blink = (this.time % 3.4) < 0.1 ? 0.15 : 1;
      parts.eyes.forEach(e => { e.scale.y = blink; });
      parts.tail.rotation.y = Math.sin(this.time * 9) * 0.3 * Math.min(1, speed / 3 + (p.ground ? 0 : 1));
      parts.rocket.visible = p.fuel > 0;
      parts.flame.visible = rocketing && Math.floor(this.time * 20) % 2 === 0;
      parts.flame.scale.y = 0.8 + Math.random() * 0.5;
    }
    const shadowY = Math.max(this.floorUnder(p.pos.x, p.pos.z, p.pos.y, 0), plat ? floor : -Infinity);
    this.heroShadow.visible = shadowY > -Infinity;
    if (this.heroShadow.visible) {
      this.heroShadow.position.set(p.pos.x, shadowY + 0.03, p.pos.z);
      this.heroShadow.scale.setScalar(THREE.MathUtils.clamp(1 - (p.pos.y - shadowY) * 0.12, 0.4, 1));
    }
  }

  updateEntities(dt) {
    const p = this.p, L = this.level;
    const chest = _w.set(p.pos.x, p.pos.y + 0.7, p.pos.z);
    const bounce = () => {
      p.vel.y = this.jumpHeld ? JUMP * 1.05 : JUMP * 0.72;
      p.ground = false; p.plat = null; p.coyote = 0;
      p.sq = -0.6; p.sqv = 0;
      sfx.stomp();
    };
    for (const e of L.ents) {
      if (!e.alive) continue;
      const m = e.mesh;
      const flat = Math.hypot(m.position.x - p.pos.x, m.position.z - p.pos.z);
      const near = p.dead <= 0 && m.position.distanceTo(chest) < 1.05;
      switch (e.type) {
        case 'gem': case 'star': case 'rocket': case 'ink':
          m.rotation.y += dt * (e.type === 'star' ? 3 : 2);
          m.position.y = e.home.y + Math.sin(this.time * 3 + e.cx) * 0.12;
          if (!near) break;
          e.alive = false; m.visible = false;
          if (e.type === 'gem') {
            this.score += 100; this.stats.gems++; sfx.gem();
            this.burst(m.position, 0x58c4f6, 6, { speed: 4 });
            this.popup(m.position, '+100', 'gem');
            if (this.stats.gems === this.stats.gemsTotal) { this.ui.banner('Every gem!', '+1000 bonus at the door'); this.popup(m.position, 'ALL GEMS!', 'big'); }
          }
          if (e.type === 'star') {
            p.star = true; this.score += 500; sfx.star();
            this.hitStop(0.09); this.shake(0.3); this.rumble(0.6, 0.6, 200);
            this.burst(m.position, 0xffd23f, 20, { speed: 8, rise: 6 });
            this.popup(m.position, '+500', 'big');
            L.exit.mesh.userData.panel?.material.color.set(0x7bd389);
            L.exit.mesh.userData.lock?.material.color.set(0xffd23f);
            music.setIntensity(1);
            this.ui.banner('Got the Ink Star!', 'Now find the door.');
          }
          if (e.type === 'rocket') { p.fuel = 100; sfx.pickup(); this.burst(m.position, 0xffd23f, 10); this.ui.banner('Rocket pencil!', this.device.touch ? 'Hold FLY to fly. Watch the fuel.' : 'Hold Shift to fly. Watch the fuel.'); }
          if (e.type === 'ink') { p.ink = true; sfx.pickup(); this.burst(m.position, INK, 10); this.ui.banner('Ink shooter!', this.device.touch ? 'Tap INK to splat things.' : 'Press F or click to splat things.'); }
          break;
        case 'flag':
          e.mesh.userData.pivot.rotation.y = Math.sin(this.time * 4 + e.cx) * (e.on ? 0.35 : 0.12);
          if (!e.on && flat < 1.2 && Math.abs(p.pos.y - e.baseH) < 1.5 && p.dead <= 0) {
            for (const f of L.flags) { f.on = false; f.mesh.userData.cloth.material.color.set(0xd6d6de); }
            e.on = true;
            e.mesh.userData.cloth.material.color.set(0xe8443a);
            this.checkpoint = V(m.position.x, e.baseH, m.position.z);
            sfx.checkpoint();
            this.burst(_v.copy(m.position).setY(m.position.y + 1.6), 0xe8443a, 10, { speed: 4 });
            this.popup(_v, 'Checkpoint!', 'big');
          }
          break;
        case 'exit':
          if (flat < 1.1 && Math.abs(p.pos.y - e.baseH) < 1.5 && p.dead <= 0) {
            if (p.star) { this.finishLevel(); return; }
            if (!e.nagged || this.time - e.nagged > 3) { e.nagged = this.time; sfx.locked(); this.ui.banner('Locked', 'The door wants the Ink Star.'); }
          }
          if (p.star && m.userData.lock) {
            m.userData.lock.rotation.z += dt * 3;
            m.userData.lock.scale.setScalar(1 + Math.sin(this.time * 6) * 0.08);
          }
          break;
        case 'spikes':
          if (flat < 0.95 && p.pos.y < e.baseH + 0.6 && p.pos.y > e.baseH - 0.5) this.kill();
          break;
        case 'eraser': {
          m.position[e.axis] += e.dir * 2.2 * dt;
          const ahead = _v.copy(m.position);
          ahead[e.axis] += e.dir * 0.7;
          if (this.groundH(ahead.x, ahead.z) !== e.baseH) e.dir *= -1;
          m.rotation.y = e.axis === 'x' ? (e.dir > 0 ? 0 : Math.PI) : (e.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
          m.position.y = e.baseH + Math.abs(Math.sin(this.time * 9 + e.cx)) * 0.1;
          const above = p.pos.y - e.baseH;
          if (p.dead <= 0 && flat < 1.0 && p.vel.y < -0.5 && above > 0.3 && above < 1.2) {
            this.defeat(e, _v.copy(m.position).setY(m.position.y + 0.4), 'stomp');
            bounce();
          } else if (flat < 0.9 && Math.abs(above) < 1) this.kill();
          break;
        }
        case 'fly': {
          e.angle += dt * 1.3;
          m.position.set(e.home.x + Math.cos(e.angle) * 2.2, e.home.y + Math.sin(this.time * 3) * 0.35, e.home.z + Math.sin(e.angle) * 2.2);
          m.rotation.y = -e.angle - Math.PI / 2;
          m.userData.wings?.forEach((w, i) => { w.rotation.x = Math.PI / 2 + Math.sin(this.time * 40) * 0.6 * (i ? 1 : -1); });
          const above = p.pos.y - m.position.y;
          if (p.dead <= 0 && flat < 0.8 && p.vel.y < -0.5 && above > -0.15 && above < 0.6) {
            this.defeat(e, m.position.clone(), 'stomp');
            bounce();
          } else if (m.position.distanceTo(chest) < 0.85) this.kill();
          break;
        }
      }
    }
  }

  updateShots(dt) {
    const L = this.level;
    for (const s of L.shots) {
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      const pos = s.mesh.position;
      s.trail -= dt;
      if (s.trail <= 0) { s.trail = 0.03; this.burst(pos, INK, 1, { speed: 0.5, up: 0, rise: 0.5, size: 0.06, life: 0.25, grav: 2 }); }
      if (this.groundH(pos.x, pos.z) > pos.y) s.life = 0;
      for (const e of L.ents) {
        if (!e.alive || (e.type !== 'eraser' && e.type !== 'fly')) continue;
        const target = _v.copy(e.mesh.position);
        if (e.type === 'eraser') target.y += 0.4;
        if (target.distanceTo(pos) < 0.75) {
          s.life = 0;
          sfx.splat();
          this.defeat(e, target.clone(), 'ink');
        }
      }
      if (s.life <= 0) { L.group.remove(s.mesh); this.burst(pos, INK, 4, { speed: 3 }); }
    }
    L.shots = L.shots.filter(s => s.life > 0);
  }

  // Third-person rig: smoothed focus with look-ahead, orbit from yaw/pitch,
  // pull-in when terrain blocks the view, then additive trauma shake on top.
  placeCamera(dt, snap = false) {
    const p = this.p;
    if (!p) return;
    const target = this.state === 'title' && this.showcaseCenter
      ? this.showcaseCenter
      : _w.set(p.pos.x, Math.max(p.pos.y, -3) + 1.1, p.pos.z);
    if (this.state === 'play' || this.state === 'exiting') {
      // lead the player's motion so you see where you're going
      _v.set(p.vel.x * 0.28, 0, p.vel.z * 0.28);
      this.lead.lerp(_v, snap ? 1 : damp(3, dt));
    } else this.lead.multiplyScalar(1 - damp(3, dt));
    _v.copy(target).add(this.lead);
    this.focus.lerp(_v, snap ? 1 : damp(9, dt));

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = Math.sin(this.yaw) * cp, dy = sp, dz = Math.cos(this.yaw) * cp;
    // occlusion: march from the focus outward; stop short of any column that pokes through the ray
    let allowed = this.dist;
    for (let i = 1; i <= 16; i++) {
      const d = (i / 16) * this.dist;
      const x = this.focus.x + dx * d, y = this.focus.y + dy * d, z = this.focus.z + dz * d;
      if (this.groundH(x, z) > y - 0.35) { allowed = Math.max(2.5, d - 0.8); break; }
    }
    // pull in fast, ease back out slowly
    const rate = allowed < this.camDist ? 14 : 2.5;
    this.camDist = snap ? allowed : this.camDist + (allowed - this.camDist) * damp(rate, dt);
    this.camera.position.set(this.focus.x + dx * this.camDist, this.focus.y + dy * this.camDist, this.focus.z + dz * this.camDist);
    this.camera.lookAt(this.focus);

    // shake rides on top of the follow and never touches the simulation
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    if (this.trauma > 0 && this.settings.shake) {
      const a = this.trauma * this.trauma, t = this.realTime * 32;
      this.camera.translateX(Math.sin(t * 1.7) * 0.32 * a);
      this.camera.translateY(Math.sin(t * 2.3 + 1) * 0.24 * a);
      this.camera.rotateZ(Math.sin(t * 1.1 + 2) * 0.05 * a);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

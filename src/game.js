import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LEVELS } from './levels.js';
import { INK, boil, terrainMaterials, inked, inkModel, dot, shadowBlob, starGeometry } from './doodle.js';
import { sfx } from './audio.js';

const CELL = 2;        // world units per grid cell
const RADIUS = 0.35;   // player collision radius
const SPEED = 7, JUMP = 12, GRAVITY = 26;
const STEP = 0.35;     // ledge height the player is nudged up onto
const PIT_DEPTH = -2;  // how far cliff walls extend below ground over pits

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const cellCenter = c => c * CELL + CELL / 2;

// ---------- terrain ----------

function buildTerrain(def, mats) {
  const D = def.h.length, W = def.h[0].length;
  const hAt = (x, z) => (x < 0 || z < 0 || x >= W || z >= D || def.h[z][x] === '.') ? null : +def.h[z][x];
  const maxH = Math.max(...def.h.join('').replace(/\./g, '').split('').map(Number));
  const lo = new THREE.Color(def.colors[0]), hi = new THREE.Color(def.colors[1]), tmp = new THREE.Color();
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
    const wall = (nh, corners) => {
      const from = nh === null ? PIT_DEPTH : nh;
      for (let y = from; y < h; y++) {
        const shade = tmp.clone().lerp(new THREE.Color(0xffffff), 0.45);
        quad(side, ...corners(y, y + 1), shade);
      }
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
  const body = inked(new THREE.CapsuleGeometry(0.27, 0.34, 4, 10), 0xffffff);
  body.position.y = 0.66;
  const head = inked(new THREE.SphereGeometry(0.34, 14, 10), 0xffffff);
  head.position.y = 1.27;
  for (const sx of [-1, 1]) { const e = dot(0.05); e.position.set(sx * 0.13, 0.05, 0.3); head.add(e); }
  const tuft = inked(new THREE.ConeGeometry(0.11, 0.3, 8), 0xffd23f);
  tuft.position.set(0, 0.42, 0); tuft.rotation.z = -0.25; head.add(tuft);
  const scarf = inked(new THREE.TorusGeometry(0.22, 0.075, 6, 12), 0xe8443a);
  scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.98;
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
  g.add(body, head, scarf, ...legs, ...arms, rocket);
  g.userData = { legs, arms, rocket, flame, body, head };
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
  g.add(body, band);
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

// ---------- the game ----------

export class Game {
  constructor(canvas, ui) {
    this.ui = ui;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    this.mats = terrainMaterials();
    this.models = {};
    this.keys = {};
    this.state = 'title';
    this.time = 0;
    this.focus = V();
    this.bindInput(canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
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
    window.addEventListener('keydown', e => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (this.state !== 'play') { if (e.code === 'Enter') this.ui.button.click(); return; }
      if (e.code === 'Space' && !e.repeat) this.p.buffer = 0.12;
      if ((e.code === 'KeyF' || e.code === 'KeyJ') && !e.repeat) this.shoot();
      if (e.code === 'KeyR') this.kill(true);
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.code === 'Space' && this.p && this.p.vel.y > 0) this.p.vel.y *= 0.5; // short hop
    });
    window.addEventListener('blur', () => { this.keys = {}; });
    let dragging = false;
    canvas.addEventListener('mousedown', () => {
      if (this.state !== 'play') return;
      if (document.pointerLockElement === canvas) this.shoot();
      else { dragging = true; canvas.requestPointerLock?.(); }
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', e => {
      if (this.state !== 'play' || !(dragging || document.pointerLockElement === canvas)) return;
      this.yaw -= e.movementX * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.003, 0.12, 1.3);
    });
    canvas.addEventListener('wheel', e => { this.dist = THREE.MathUtils.clamp(this.dist + Math.sign(e.deltaY), 6, 18); }, { passive: true });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ----- flow -----

  newGame(levelIndex = 0) {
    this.score = 0;
    this.lives = 3;
    this.loadLevel(levelIndex);
    this.state = 'play';
    this.ui.showHud(true);
    this.ui.overlay(null);
  }

  loadLevel(index) {
    if (this.level) {
      this.scene.remove(this.level.group);
      this.level.group.traverse(o => { if (o.isMesh && o.geometry.attributes.color) o.geometry.dispose(); });
    }
    const def = LEVELS[index];
    const L = this.level = {
      def, group: new THREE.Group(), w: def.h[0].length, d: def.h.length,
      ents: [], platforms: [], shots: [], bits: [],
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
    for (let cz = 0; cz < L.d; cz++) for (let cx = 0; cx < L.w; cx++) {
      const ch = def.o[cz][cx];
      if (ch === 'P') this.start = V(cellCenter(cx), +def.h[cz][cx], cellCenter(cz));
      else if (ch === 'o') add('gem', this.make('gem', () => inked(new THREE.OctahedronGeometry(0.3), 0x58c4f6, { mode: 2 })), cx, cz, 0.8);
      else if (ch === 'S') add('star', this.make('star', () => inked(starGeometry(), 0xffd23f, { mode: 2 })), cx, cz, 1.1);
      else if (ch === 'E') L.exit = add('exit', this.make('exit', makeDoor), cx, cz);
      else if (ch === '^') add('spikes', makeSpikes(), cx, cz);
      else if (ch === 'm' || ch === 'M') add('eraser', this.make('eraser', makeEraser), cx, cz, 0, { axis: ch === 'm' ? 'x' : 'z', dir: 1 });
      else if (ch === 'b') add('fly', this.make('fly', makeFly), cx, cz, 1.4, { angle: Math.random() * 6 });
      else if (ch === 'R') add('rocket', makeRocket(), cx, cz, 0.9);
      else if (ch === 'I') add('ink', makeInkBottle(), cx, cz, 0.7);
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
      pos: this.start.clone(), vel: V(), ground: false, coyote: 0, buffer: 0, face: Math.PI / 2,
      fuel: 0, ink: false, star: false, dead: 0, cool: 0, plat: null, walk: 0, safe: 0,
    };
    this.yaw = -Math.PI / 2;
    this.pitch = 0.55;
    this.dist = 10;
    this.focus.copy(this.start);
    this.placeCamera(1);
    this.ui.banner(def.name, def.hint);
    this.ui.hud(this);
  }

  kill(force = false) {
    const p = this.p;
    if (p.dead > 0 || (!force && p.safe > 0)) return;
    p.dead = 0.8;
    sfx.die();
    this.burst(p.pos.clone().setY(p.pos.y + 0.8), 0xe8443a);
  }

  afterDeath() {
    const p = this.p;
    this.lives--;
    if (this.lives <= 0) {
      this.state = 'over';
      this.ui.showHud(false);
      this.ui.overlay('Rubbed out!', `Pip got erased on ${this.level.def.name}. Final score: ${this.score}.`, 'Try again', () => this.newGame(0));
      return;
    }
    p.pos.copy(this.start);
    p.vel.set(0, 0, 0);
    p.dead = 0;
    p.safe = 1.5;
    p.plat = null;
    this.hero.scale.setScalar(1);
    this.ui.hud(this);
  }

  finishLevel() {
    sfx.door();
    this.score += 1000 + Math.round(this.p.fuel) * 5;
    if (this.index + 1 < LEVELS.length) { this.loadLevel(this.index + 1); return; }
    this.state = 'win';
    this.ui.showHud(false);
    document.exitPointerLock?.();
    this.ui.overlay('Off the page!', `Pip made it through every page. Final score: ${this.score}.`, 'Play again', () => this.newGame(0));
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
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: INK }));
    mesh.position.set(p.pos.x, p.pos.y + 0.85, p.pos.z);
    this.level.group.add(mesh);
    this.level.shots.push({ mesh, vel: V(Math.sin(p.face) * 18, 0, Math.cos(p.face) * 18), life: 1.1 });
  }

  burst(at, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07 + Math.random() * 0.06, 6, 4), new THREE.MeshBasicMaterial({ color }));
      mesh.position.copy(at);
      this.level.group.add(mesh);
      this.level.bits.push({ mesh, vel: V((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6), life: 0.55 });
    }
  }

  // ----- update -----

  update(dt) {
    this.time += dt;
    boil.value = Math.floor(this.time * 7);
    if (this.state !== 'play') { if (this.level) this.placeCamera(dt * 2); return; }
    const k = this.keys;
    this.yaw += ((k.KeyQ ? 1 : 0) - (k.KeyE ? 1 : 0)) * 2.2 * dt;

    for (const pl of this.level.platforms) {
      const t = 0.5 - 0.5 * Math.cos((this.time / pl.period) * Math.PI * 2);
      const before = pl.mesh.position.clone();
      pl.mesh.position.lerpVectors(pl.a, pl.b, t);
      pl.delta.subVectors(pl.mesh.position, before);
    }
    this.updatePlayer(dt);
    this.updateEntities(dt);
    this.updateShots(dt);
    this.placeCamera(dt);
    this.ui.hud(this);
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

    const ix = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const iz = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    let mx = -s * iz + c * ix, mz = -c * iz - s * ix;
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; p.face = Math.atan2(mx, mz); }
    const grip = Math.min(1, (p.ground ? 14 : 6) * dt);
    p.vel.x += (mx * SPEED - p.vel.x) * grip;
    p.vel.z += (mz * SPEED - p.vel.z) * grip;

    p.coyote = p.ground ? 0.1 : p.coyote - dt;
    p.buffer -= dt;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vel.y = JUMP; p.buffer = 0; p.coyote = 0; p.ground = false; p.plat = null;
      sfx.jump();
    }
    const rocketing = (k.ShiftLeft || k.ShiftRight) && p.fuel > 0;
    if (rocketing) {
      p.vel.y += (7 - p.vel.y) * Math.min(1, 8 * dt);
      p.fuel = Math.max(0, p.fuel - 14 * dt);
      p.ground = false; p.plat = null;
    } else {
      p.vel.y -= GRAVITY * dt;
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

    // pose
    hero.position.copy(p.pos);
    let turn = p.face - hero.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    hero.rotation.y += turn * Math.min(1, 14 * dt);
    hero.visible = p.safe <= 0 || Math.floor(this.time * 14) % 2 === 0;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (parts.legs) {
      p.walk += speed * dt * 2.2;
      const swing = p.ground ? Math.sin(p.walk) * Math.min(1, speed / 3) * 0.9 : 0.5;
      parts.legs[0].rotation.x = swing; parts.legs[1].rotation.x = -swing;
      parts.arms[0].rotation.x = -swing; parts.arms[1].rotation.x = swing;
      const stretch = p.ground ? 1 : 1 + THREE.MathUtils.clamp(p.vel.y * 0.012, -0.1, 0.14);
      hero.scale.set(1 / stretch, stretch, 1 / stretch);
      parts.rocket.visible = p.fuel > 0;
      parts.flame.visible = rocketing && Math.floor(this.time * 20) % 2 === 0;
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
    const chest = V(p.pos.x, p.pos.y + 0.7, p.pos.z);
    for (const e of L.ents) {
      if (!e.alive) continue;
      const m = e.mesh;
      const flat = Math.hypot(m.position.x - p.pos.x, m.position.z - p.pos.z);
      const near = p.dead <= 0 && m.position.distanceTo(chest) < 1.05;
      switch (e.type) {
        case 'gem': case 'star': case 'rocket': case 'ink':
          m.rotation.y += dt * 2;
          m.position.y = e.home.y + Math.sin(this.time * 3 + e.cx) * 0.12;
          if (!near) break;
          e.alive = false; m.visible = false;
          if (e.type === 'gem') { this.score += 100; sfx.gem(); this.burst(m.position, 0x58c4f6, 5); }
          if (e.type === 'star') {
            p.star = true; this.score += 500; sfx.star(); this.burst(m.position, 0xffd23f, 12);
            L.exit.mesh.userData.panel?.material.color.set(0x7bd389);
            L.exit.mesh.userData.lock?.material.color.set(0xffd23f);
            this.ui.banner('Got the Ink Star!', 'Now find the door.');
          }
          if (e.type === 'rocket') { p.fuel = 100; sfx.pickup(); this.ui.banner('Rocket pencil!', 'Hold Shift to fly. Watch the fuel.'); }
          if (e.type === 'ink') { p.ink = true; sfx.pickup(); this.ui.banner('Ink shooter!', 'Press F or click to splat things.'); }
          break;
        case 'exit':
          if (flat < 1.1 && Math.abs(p.pos.y - e.baseH) < 1.5 && p.dead <= 0) {
            if (p.star) { this.finishLevel(); return; }
            if (!e.nagged || this.time - e.nagged > 3) { e.nagged = this.time; sfx.locked(); this.ui.banner('Locked', 'The door wants the Ink Star.'); }
          }
          if (p.star) m.userData.lock && (m.userData.lock.rotation.z += dt * 3);
          break;
        case 'spikes':
          if (flat < 0.95 && p.pos.y < e.baseH + 0.6 && p.pos.y > e.baseH - 0.5) this.kill();
          break;
        case 'eraser': {
          m.position[e.axis] += e.dir * 2.2 * dt;
          const ahead = m.position.clone();
          ahead[e.axis] += e.dir * 0.7;
          if (this.groundH(ahead.x, ahead.z) !== e.baseH) e.dir *= -1;
          m.rotation.y = e.axis === 'x' ? (e.dir > 0 ? 0 : Math.PI) : (e.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
          m.position.y = e.baseH + Math.abs(Math.sin(this.time * 9 + e.cx)) * 0.1;
          if (flat < 0.9 && Math.abs(p.pos.y - e.baseH) < 1) this.kill();
          break;
        }
        case 'fly':
          e.angle += dt * 1.3;
          m.position.set(e.home.x + Math.cos(e.angle) * 2.2, e.home.y + Math.sin(this.time * 3) * 0.35, e.home.z + Math.sin(e.angle) * 2.2);
          m.rotation.y = -e.angle - Math.PI / 2;
          m.userData.wings?.forEach((w, i) => { w.rotation.x = Math.PI / 2 + Math.sin(this.time * 40) * 0.6 * (i ? 1 : -1); });
          if (m.position.distanceTo(chest) < 0.85) this.kill();
          break;
      }
    }
  }

  updateShots(dt) {
    const L = this.level;
    for (const s of L.shots) {
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      const pos = s.mesh.position;
      if (this.groundH(pos.x, pos.z) > pos.y) s.life = 0;
      for (const e of L.ents) {
        if (!e.alive || (e.type !== 'eraser' && e.type !== 'fly')) continue;
        const target = e.mesh.position.clone();
        if (e.type === 'eraser') target.y += 0.4;
        if (target.distanceTo(pos) < 0.75) {
          e.alive = false; e.mesh.visible = false; s.life = 0;
          this.score += 300; sfx.splat(); this.burst(target, INK, 10);
        }
      }
      if (s.life <= 0) { L.group.remove(s.mesh); this.burst(pos, INK, 3); }
    }
    L.shots = L.shots.filter(s => s.life > 0);
    for (const b of L.bits) {
      b.life -= dt;
      b.vel.y -= 14 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      if (b.life <= 0) L.group.remove(b.mesh);
    }
    L.bits = L.bits.filter(b => b.life > 0);
  }

  placeCamera(dt) {
    const p = this.p;
    if (!p) return;
    const ease = Math.min(1, dt * 8);
    this.focus.lerp(V(p.pos.x, Math.max(p.pos.y, -3) + 1.1, p.pos.z), ease);
    const cp = Math.cos(this.pitch);
    const want = V(
      this.focus.x + Math.sin(this.yaw) * cp * this.dist,
      this.focus.y + Math.sin(this.pitch) * this.dist,
      this.focus.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.position.lerp(want, ease);
    this.camera.lookAt(this.focus);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

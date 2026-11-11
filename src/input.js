// Touch controls (phones/tablets) and gamepads (consoles, TV boxes, Bluetooth pads).
// Both write into game.virt and call game.pressJump / releaseJump / shoot / togglePause.

const DEAD = 0.18;

export const device = (() => {
  const ua = navigator.userAgent;
  const q = new URLSearchParams(location.search);
  const tv = q.has('tv') || /\b(TV|AFT\w*|SMART-TV|SmartTV|Tizen|Web0S|webOS|BRAVIA|GoogleTV|CrKey|HbbTV|Android TV|AppleTV)\b/i.test(ua);
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const touch = !tv && (q.has('touch') || matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
  const mobile = ios || /Android|Mobi/i.test(ua);
  return { tv, ios, touch, mobile };
})();

// ---------- touch ----------

export class TouchControls {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.stick = null;   // { id, ox, oy }
    this.look = null;    // { id, x, y }
    this.base = root.querySelector('#t-stick');
    this.knob = root.querySelector('#t-knob');
    this.radius = 56;

    const hold = (id, down, up) => {
      const el = root.querySelector(id);
      const end = e => { if (el.dataset.pid == e.pointerId) { el.dataset.pid = ''; el.classList.remove('down'); up?.(); } };
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        el.dataset.pid = e.pointerId; el.classList.add('down');
        down();
        try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        try { navigator.vibrate?.(8); } catch { /* no haptics */ }
      });
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);
    };
    hold('#t-jump', () => game.pressJump(), () => game.releaseJump());
    hold('#t-ink', () => game.shoot());
    hold('#t-rocket', () => { game.virt.rocket = true; }, () => { game.virt.rocket = false; });
    hold('#t-pause', () => game.togglePause());

    window.addEventListener('pointerdown', e => this.down(e), { passive: false });
    window.addEventListener('pointermove', e => this.move(e), { passive: false });
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.up(e));
  }

  down(e) {
    if (e.pointerType !== 'touch') return;
    document.body.classList.add('touch');
    if (this.game.state !== 'play') return;
    e.preventDefault(); // stops emulated mouse events and double-tap zoom
    const leftSide = e.clientX < window.innerWidth * 0.45;
    if (leftSide && !this.stick) {
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.base.style.left = e.clientX + 'px';
      this.base.style.top = e.clientY + 'px';
      this.base.classList.add('on');
      this.knob.style.transform = 'translate(-50%,-50%)';
    } else if (!leftSide && !this.look) {
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  }

  move(e) {
    if (e.pointerType !== 'touch') return;
    const s = this.stick, l = this.look;
    if (s && e.pointerId === s.id) {
      e.preventDefault();
      let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
      const d = Math.hypot(dx, dy), r = this.radius;
      if (d > r) {
        // drag the base along so the thumb never "falls off" the stick
        s.ox += dx * (1 - r / d); s.oy += dy * (1 - r / d);
        this.base.style.left = s.ox + 'px'; this.base.style.top = s.oy + 'px';
        dx = e.clientX - s.ox; dy = e.clientY - s.oy;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const mag = Math.min(1, Math.hypot(dx, dy) / r);
      const k = mag < DEAD ? 0 : (mag - DEAD) / (1 - DEAD) / (mag || 1);
      this.game.virt.x = (dx / r) * k;
      this.game.virt.z = (-dy / r) * k;
      this.game.useAutoCam(true);
    } else if (l && e.pointerId === l.id) {
      e.preventDefault();
      this.game.look((e.clientX - l.x) * 0.008, (e.clientY - l.y) * 0.005);
      l.x = e.clientX; l.y = e.clientY;
    }
  }

  up(e) {
    if (this.stick && e.pointerId === this.stick.id) {
      this.stick = null;
      this.base.classList.remove('on');
      this.game.virt.x = this.game.virt.z = 0;
    }
    if (this.look && e.pointerId === this.look.id) this.look = null;
  }

  reset() {
    this.stick = this.look = null;
    this.base.classList.remove('on');
    this.root.querySelectorAll('.down').forEach(b => { b.classList.remove('down'); b.dataset.pid = ''; });
  }
}

// ---------- gamepad (standard mapping) ----------

export class Gamepads {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.prev = [];
    this.navCool = 0;
    this.active = false;
    this.enabled = true;
    window.addEventListener('gamepadconnected', () => { this.active = true; ui.banner('Controller connected', 'A jump · X ink · RT rocket · Start pause'); });
  }

  // Dual-motor rumble where the browser supports it (Chrome/Edge; silently ignored elsewhere).
  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    if (!this.active || !this.enabled || !navigator.getGamepads) return;
    try {
      const pad = [...navigator.getGamepads()].find(p => p && p.connected);
      pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch?.(() => {});
    } catch { /* no haptics */ }
  }

  poll(dt) {
    if (!this.active || !navigator.getGamepads) return;
    const pad = [...navigator.getGamepads()].find(p => p && p.connected);
    if (!pad) return;
    const b = i => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.5;
    const pressed = i => b(i) && !this.prev[i];
    const released = i => !b(i) && this.prev[i];
    const ax = i => { const v = pad.axes[i] ?? 0; return Math.abs(v) < DEAD ? 0 : v; };
    const g = this.game;

    if (g.state === 'play') {
      let x = ax(0) + (b(15) ? 1 : 0) - (b(14) ? 1 : 0);
      let z = -ax(1) + (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
      const m = Math.hypot(x, z);
      if (m > 1) { x /= m; z /= m; }
      g.virt.x = x; g.virt.z = z;
      if (m > 0) g.useAutoCam(true);
      const lx = ax(2), ly = ax(3);
      if (lx || ly) g.look(lx * 2.6 * dt, ly * 1.6 * dt);
      if (pressed(0)) g.pressJump();
      if (released(0)) g.releaseJump();
      if (pressed(2) || pressed(1)) g.shoot();
      g.virt.rocket = b(7) || b(6) || b(5);
      if (pressed(9) || pressed(8)) g.togglePause();
    } else {
      this.navCool -= dt;
      const dir = (b(15) || ax(0) > 0.5 || b(13) || ax(1) > 0.5) ? 1 : (b(14) || ax(0) < -0.5 || b(12) || ax(1) < -0.5) ? -1 : 0;
      if (dir && this.navCool <= 0) { this.ui.moveFocus(dir); this.navCool = 0.25; }
      if (!dir) this.navCool = 0;
      if (pressed(0) || pressed(9)) this.ui.activate();
      if (pressed(1)) this.ui.back();
    }
    this.prev = pad.buttons.map((_, i) => b(i));
  }
}

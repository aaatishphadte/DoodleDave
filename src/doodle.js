// The hand-drawn look: paper textures, wobbly ink outlines, scribbled shadows.
import * as THREE from 'three';

export const INK = 0x1b1b24;
// Shared "boil" clock. It ticks a few times a second so outlines redraw like flipbook frames.
export const boil = { value: 0 };

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function wobblyLine(ctx, r, x1, y1, x2, y2, wob = 3) {
  const n = 8;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x1 + (x2 - x1) * t + (r() - 0.5) * wob;
    const y = y1 + (y2 - y1) * t + (r() - 0.5) * wob;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}

export function terrainMaterials() {
  // Tops: coloured-pencil shading with a sketched border, tinted per level through vertex colours.
  const top = makeTexture(128, 128, (ctx, w, h) => {
    const r = rng(7);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    for (let i = 0; i < 46; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
      const x = r() * w * 1.4 - w * 0.2, y = r() * h, len = 20 + r() * 50;
      wobblyLine(ctx, r, x, y, x + len, y - len * 0.8, 4);
    }
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(27,27,36,0.6)';
    for (let pass = 0; pass < 2; pass++) {
      wobblyLine(ctx, r, 3, 3, w - 3, 3); wobblyLine(ctx, r, w - 3, 3, w - 3, h - 3);
      wobblyLine(ctx, r, w - 3, h - 3, 3, h - 3); wobblyLine(ctx, r, 3, h - 3, 3, 3);
    }
  });
  // Sides: cross-hatched like the shaded edge of a stack of paper.
  const side = makeTexture(256, 128, (ctx, w, h) => {
    const r = rng(21);
    ctx.fillStyle = '#efe9da';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(27,27,36,0.42)';
    ctx.lineWidth = 2;
    for (let x = -h; x < w; x += 13) wobblyLine(ctx, r, x, h, x + h * 0.7, 0, 4);
    ctx.strokeStyle = 'rgba(27,27,36,0.18)';
    for (let x = 0; x < w + h; x += 29) wobblyLine(ctx, r, x, h, x - h * 0.7, 0, 4);
    ctx.strokeStyle = 'rgba(27,27,36,0.9)';
    ctx.lineWidth = 5;
    wobblyLine(ctx, r, 0, 4, w, 4, 3);
    ctx.lineWidth = 2;
    wobblyLine(ctx, r, 0, h - 2, w, h - 2, 2);
  });
  return {
    top: new THREE.MeshBasicMaterial({ map: top, vertexColors: true }),
    side: new THREE.MeshBasicMaterial({ map: side, vertexColors: true, side: THREE.DoubleSide }),
  };
}

const outlineCache = new Map();
// mode 0: push along normals (round shapes), 1: push box corners outward, 2: push away from centre (stars, gems)
function outlineMaterial(mode, thick) {
  const k = mode + ':' + thick;
  if (!outlineCache.has(k)) {
    outlineCache.set(k, new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uT: boil, uThick: { value: thick }, uMode: { value: mode } },
      vertexShader: /* glsl */`
        uniform float uT; uniform float uThick; uniform float uMode;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main() {
          vec3 dir = normalize(normal);
          if (uMode > 1.5) dir = normalize(position + vec3(0.0001));
          else if (uMode > 0.5) dir = sign(position);
          float wobble = hash(position * 7.0 + uT) - 0.35;
          vec3 p = position + dir * uThick * (1.0 + wobble);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`void main() { gl_FragColor = vec4(0.03, 0.03, 0.045, 1.0); }`,
    }));
  }
  return outlineCache.get(k);
}

// A flat-coloured mesh with a wobbly ink outline around it.
export function inked(geometry, color, { mode = 0, thick = 0.045 } = {}) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }));
  mesh.add(new THREE.Mesh(geometry, outlineMaterial(mode, thick)));
  return mesh;
}

// Give an imported model (Blender / Tripo GLB) the same ink outline.
export function inkModel(root) {
  const meshes = [];
  root.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) meshes.push(o); });
  for (const m of meshes) m.add(new THREE.Mesh(m.geometry, outlineMaterial(0, 0.03)));
  return root;
}

export function dot(radius = 0.05) {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), new THREE.MeshBasicMaterial({ color: INK }));
}

let shadowTex;
export function shadowBlob(size = 1) {
  shadowTex ||= makeTexture(64, 64, (ctx) => {
    const r = rng(3);
    ctx.strokeStyle = 'rgba(27,27,36,0.5)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const y = 8 + i * 1.9, half = Math.sqrt(Math.max(0, 1 - ((y - 32) / 25) ** 2)) * 26;
      wobblyLine(ctx, r, 32 - half, y + 3, 32 + half, y - 3, 3);
    }
  });
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

export function starGeometry(outer = 0.45, inner = 0.2, depth = 0.16) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rad = i % 2 ? inner : outer;
    i ? s.lineTo(Math.cos(a) * rad, Math.sin(a) * rad) : s.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

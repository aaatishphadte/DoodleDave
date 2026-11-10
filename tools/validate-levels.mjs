// Checks level grids and does a rough "can the player get there" search.
import { LEVELS } from '../src/levels.js';

let bad = 0;
const fail = (li, msg) => { bad++; console.log(`  FAIL level ${li + 1}: ${msg}`); };

LEVELS.forEach((L, li) => {
  const D = L.h.length, W = L.h[0].length;
  console.log(`Level ${li + 1}: ${L.name} (${W}x${D})`);
  if (L.o.length !== D) fail(li, 'h and o have different row counts');
  L.h.forEach((r, z) => { if (r.length !== W) fail(li, `h row ${z} has length ${r.length}, expected ${W}`); });
  L.o.forEach((r, z) => { if (r.length !== W) fail(li, `o row ${z} has length ${r.length}, expected ${W}`); });

  // each cell gets a height range [lo, hi]; platforms cover the cells they sweep
  const range = new Map();
  const key = (x, z) => x + ',' + z;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const c = L.h[z][x];
    if (c !== '.') range.set(key(x, z), [+c, +c]);
  }
  for (const p of L.platforms) {
    const [x0, y0, z0] = p.from, [x1, y1, z1] = p.to;
    const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0), 1);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + (x1 - x0) * i / n), z = Math.round(z0 + (z1 - z0) * i / n);
      if (L.h[z][x] !== '.') fail(li, `platform passes through solid cell ${x},${z}`);
      range.set(key(x, z), [Math.min(y0, y1), Math.max(y0, y1)]);
    }
  }

  const find = ch => { const out = []; L.o.forEach((r, z) => [...r].forEach((c, x) => { if (c === ch) out.push([x, z]); })); return out; };
  for (const ch of ['P', 'S', 'E']) if (find(ch).length !== 1) fail(li, `needs exactly one '${ch}', found ${find(ch).length}`);
  L.o.forEach((r, z) => [...r].forEach((c, x) => { if (c !== '.' && L.h[z][x] === '.') fail(li, `'${c}' at ${x},${z} floats over a pit`); }));
  if (bad) return;

  // jump rules: adjacent cell up to +2, over one empty cell up to +1, over two empty cells level or down
  const limits = [2, 1, 0];
  const [sx, sz] = find('P')[0];
  const seen = new Set([key(sx, sz)]);
  const queue = [[sx, sz]];
  while (queue.length) {
    const [x, z] = queue.shift();
    const a = range.get(key(x, z));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let gap = 0; gap < 3; gap++) {
        const nx = x + dx * (gap + 1), nz = z + dz * (gap + 1);
        const b = range.get(key(nx, nz));
        if (b) {
          if (b[0] - a[1] <= limits[gap] && !seen.has(key(nx, nz))) { seen.add(key(nx, nz)); queue.push([nx, nz]); }
          break; // can't jump through a column
        }
      }
    }
  }
  const reach = ([x, z]) => seen.has(key(x, z));
  const rocket = find('R').some(reach);
  if (!reach(find('S')[0])) fail(li, 'star is not reachable on foot');
  if (!reach(find('E')[0])) fail(li, 'exit is not reachable on foot');
  const lostGems = find('o').filter(c => !reach(c));
  if (lostGems.length && !rocket) fail(li, `gems unreachable: ${lostGems.map(c => c.join(',')).join(' ')}`);
  else if (lostGems.length) console.log(`  note: ${lostGems.length} gem(s) need the rocket`);
});

console.log(bad ? `\n${bad} problem(s)` : '\nAll levels OK');
process.exit(bad ? 1 : 0);

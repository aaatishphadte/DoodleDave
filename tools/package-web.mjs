// Zips a portal build into release/:  node tools/package-web.mjs <itch|poki|crazygames>
// index.html sits at the zip root, which is what itch.io, Poki and CrazyGames expect.
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const src = path.join('build', target);
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error(`No build found in ${src}. Run "npm run build:${target}" first.`);
  process.exit(1);
}
fs.mkdirSync('release', { recursive: true });
const out = path.join('release', `doodle-dash-${target}-html5-v${pkg.version}.zip`);
const zip = new AdmZip();
zip.addLocalFolder(src, '', f => !f.endsWith('.md'));
zip.writeZip(out);
console.log(`Wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);

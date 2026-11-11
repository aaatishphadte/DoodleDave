// Copies the Tauri outputs into release/ with versioned names:
//   DoodleDash-<v>-portable.exe   single file, runs without installing (needs WebView2, built into Windows 10/11)
//   DoodleDash-<v>-setup.exe      installer (adds Start menu entry, installs WebView2 if missing)
import fs from 'node:fs';
import path from 'node:path';

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const target = path.join('src-tauri', 'target', 'release');
fs.mkdirSync('release', { recursive: true });

const copy = (from, name) => {
  const to = path.join('release', name);
  fs.copyFileSync(from, to);
  console.log(`Wrote ${to} (${(fs.statSync(to).size / 1024 / 1024).toFixed(1)} MB)`);
};

copy(path.join(target, 'doodle-dash.exe'), `DoodleDash-${version}-portable.exe`);
const nsisDir = path.join(target, 'bundle', 'nsis');
const setup = fs.existsSync(nsisDir) && fs.readdirSync(nsisDir).find(f => f.endsWith('-setup.exe'));
if (setup) copy(path.join(nsisDir, setup), `DoodleDash-${version}-setup.exe`);
else console.warn('No NSIS installer found; only the portable exe was copied.');

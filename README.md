# Doodle Dash

A third-person 3D platformer drawn like a notebook doodle, built with Three.js. On each page, grab the **Ink Star**, then reach the **door**. Five pages (levels), three lives.

## Run it

Requires Node.js 18+.

```bash
npm install
npm run dev        # play at the URL Vite prints
npm run build      # production build into dist/
npm run validate   # check level grids and that every star/door is reachable
```

Dev shortcut: open `/?level=3` to jump straight to a page.

## Controls

**Keyboard + mouse**

| Key | Action |
|-----|--------|
| WASD / arrows | Move |
| Space | Jump (tap for a short hop) |
| Shift | Fly with the rocket pencil (needs fuel) |
| F / click | Shoot ink (after picking up the ink bottle) |
| Mouse drag / Q, E | Turn the camera; scroll wheel zooms |
| P / Esc | Pause |
| R | Restart the page (costs a life) |

**Phones and tablets (iOS / Android)** – the left thumb anywhere on the left side is a floating joystick; dragging on the right side turns the camera. On-screen buttons: **Jump**, **Ink** and **Fly**, which appear once you pick those items up, plus **Pause**. The camera follows behind you automatically. Landscape is best. Tap *Full screen* on Android, or use *Add to Home Screen* on iPhone to play without browser bars.

**Game controllers** (Xbox / PlayStation / Bluetooth pads, Android TV, Fire TV) – left stick or D-pad to move, right stick for the camera, A jump, X / B ink, RT / LT / RB rocket, Start pause. The D-pad and A also work in menus.

**TV remotes** (Android TV, Fire TV, Tizen, webOS) – arrows to move, OK to jump, and holding OK while falling fires the rocket. Ink fires by itself at enemies straight ahead. Back pauses. TV mode is detected automatically; add `?tv` to the URL to force it, or `?touch` to force touch controls.

## Gameplay

- **Gems** – 100 points each
- **Ink Star** – unlocks the door, 500 points
- **Door** – finishes the page, 1000 points plus a bonus for leftover fuel
- **Rocket pencil** – limited-fuel flight
- **Ink bottle** – lets you shoot erasers and scribble-flies (300 points each)
- **Hazards** – pits, pencil spikes, patrolling erasers, circling scribble-flies
- **Sticky notes** – moving platforms you can ride
- **Stomp** – land on an eraser or scribble-fly to squash it (200 points); hold jump for a higher bounce
- **Checkpoint flags** – touch one and you respawn there instead of at the start
- **Three stars per page** – clear it, collect every gem (+1000 bonus), beat the par time (speed bonus)
- **Progress is saved** – best score and stars per page, unlocked pages, and settings (music, sound, screen shake & rumble) persist in the browser. *Pages* on the title screen replays any unlocked page.

## Project layout

```
index.html               page, HUD, start screen
src/main.js              boot, UI wiring, game loop
src/input.js             touch controls, gamepads, device detection
src/game.js              terrain, player, enemies, camera
src/doodle.js            hand-drawn look: paper textures, ink outlines, shadows
src/levels.js            level grids (edit these to make new pages)
src/audio.js             synth SFX, bus mixer, adaptive procedural music
src/save.js              versioned save data (localStorage, validated, with backup)
src/platform.js          Poki / CrazyGames SDKs, ad breaks
src-tauri/               Rust (Tauri) desktop app for the Windows exe
public/models/           optional GLB model overrides (see README there)
public/manifest.webmanifest, icons   home-screen install (PWA)
tools/validate-levels.mjs  level checker
tools/blender_prep.py      Blender script to prepare Tripo/GLB models
```

## Editing levels

Each level in [src/levels.js](src/levels.js) is two same-sized text grids:

- `h` – ground height per cell (`1`–`9`, `.` for a pit)
- `o` – objects: `P` start, `S` star, `E` door, `o` gem, `^` spikes, `m`/`M` eraser (patrols along x/z), `b` fly, `R` rocket, `I` ink, `C` checkpoint
- `par` – target time in seconds for the third star

Run `npm run validate` after editing.

## Custom 3D models (Blender + Tripo)

Characters and props are built-in doodle shapes. Replace any of them with a GLB from Tripo or Blender:

```bash
blender -b -P tools/blender_prep.py -- path/to/model.glb hero
```

Slots: `hero`, `eraser`, `fly`, `gem`, `star`, `exit`. See [public/models/README.md](public/models/README.md).

## Release builds (Windows exe, itch.io, Poki, CrazyGames)

`npm run release` validates the levels and writes everything to `release/`:

| File | Use it for |
|------|------------|
| `DoodleDash-<v>-portable.exe` | Single-file Windows game (~3 MB, Rust/Tauri). Runs without installing. |
| `DoodleDash-<v>-setup.exe` | Windows installer (Start menu entry, installs WebView2 if missing). |
| `doodle-dash-itch-html5-v<v>.zip` | itch.io HTML5 upload |
| `doodle-dash-poki-html5-v<v>.zip` | Poki submission (Poki SDK built in) |
| `doodle-dash-crazygames-html5-v<v>.zip` | CrazyGames submission (CrazyGames SDK v3 built in) |

Single targets: `npm run build:exe`, `build:itch`, `build:poki`, `build:crazygames`. `npm run exe:dev` opens the desktop app with live reload.

The desktop app lives in `src-tauri/` and needs Rust plus the MSVC build tools. Windows 10/11 already ships WebView2. In the desktop app, F11 or Alt+Enter toggles full screen.

**GitHub Release:** bump `version` in `package.json` and `src-tauri/tauri.conf.json`, then push a tag (`git tag v1.0.1 && git push origin v1.0.1`). [.github/workflows/release.yml](.github/workflows/release.yml) builds all of the above and attaches it to the release.

### Monetization by platform

| Platform | How it earns | What the build does |
|----------|--------------|---------------------|
| Poki | Revenue share from Poki's ads | `gameplayStart/Stop`, a commercial break between pages and on retry, and a rewarded break for "+1 life" on game over |
| CrazyGames | Revenue share from CrazyGames' ads | The same hooks through SDK v3 (`midgame` and `rewarded` ads) |
| itch.io | Set a price, or "pay what you want" with donations, on the itch page | No ads. Upload the zip as *HTML (played in browser)*, set the viewport to 1280×720, and tick *Mobile friendly* and *Fullscreen button*. Add the exe as a downloadable, paid or free. |
| Website / exe | — | No ads |

- **Muting:** sound is muted during every ad.
- **Ad blockers:** if the SDK is blocked, the game simply runs without ads.
- **Links:** portal builds drop the external credits link (portals don't allow off-site links) but keep the credit text.
- **Code:** all the SDK code is in [src/platform.js](src/platform.js).

**Submitting:** Poki is invite/review based (apply at developers.poki.com and test with their Inspector tool). CrazyGames uses its developer portal and QA tool. Both review gameplay, load time and ad placement before publishing.

## Credits

- Designed by [BooleanChitra](https://booleanchitra.dattatrayfadte.workers.dev)
- Developed by DataTree Studios

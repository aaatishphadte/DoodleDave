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

| Key | Action |
|-----|--------|
| WASD / arrows | Move |
| Space | Jump (tap for a short hop) |
| Shift | Fly with the rocket pencil (needs fuel) |
| F / click | Shoot ink (after picking up the ink bottle) |
| Mouse drag / Q, E | Turn the camera; scroll wheel zooms |
| R | Restart the page (costs a life) |

## Gameplay

- **Gems** – 100 points each
- **Ink Star** – unlocks the door, 500 points
- **Door** – finishes the page, 1000 points plus a bonus for leftover fuel
- **Rocket pencil** – limited-fuel flight
- **Ink bottle** – lets you shoot erasers and scribble-flies (300 points each)
- **Hazards** – pits, pencil spikes, patrolling erasers, circling scribble-flies
- **Sticky notes** – moving platforms you can ride

## Project layout

```
index.html               page, HUD, start screen
src/main.js              boot, UI wiring, game loop
src/game.js              terrain, player, enemies, camera
src/doodle.js            hand-drawn look: paper textures, ink outlines, shadows
src/levels.js            level grids (edit these to make new pages)
src/audio.js             synthesized sound effects
public/models/           optional GLB model overrides (see README there)
tools/validate-levels.mjs  level checker
tools/blender_prep.py      Blender script to prepare Tripo/GLB models
```

## Editing levels

Each level in [src/levels.js](src/levels.js) is two same-sized text grids:

- `h` – ground height per cell (`1`–`9`, `.` for a pit)
- `o` – objects: `P` start, `S` star, `E` door, `o` gem, `^` spikes, `m`/`M` eraser (patrols along x/z), `b` fly, `R` rocket, `I` ink

Run `npm run validate` after editing.

## Custom 3D models (Blender + Tripo)

Characters and props are built-in doodle shapes. Replace any of them with a GLB from Tripo or Blender:

```bash
blender -b -P tools/blender_prep.py -- path/to/model.glb hero
```

Slots: `hero`, `eraser`, `fly`, `gem`, `star`, `exit`. See [public/models/README.md](public/models/README.md).

## Credits

- Designed by [BooleanChitra](https://booleanchitra.dattatrayfadte.workers.dev)
- Developed by DataTree Studios

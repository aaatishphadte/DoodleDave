# Swapping in Blender / Tripo models

The game ships with built-in doodle shapes. Any of them can be replaced by a GLB:

| slot     | what it replaces   | height (units) |
|----------|--------------------|----------------|
| `hero`   | Pip, the player    | 1.6            |
| `eraser` | walking enemy      | 0.7            |
| `fly`    | flying enemy       | 0.6            |
| `gem`    | collectible        | 0.6            |
| `star`   | the Ink Star       | 0.9            |
| `exit`   | the door           | 2.3            |

1. Generate a model in Tripo and download it as GLB (a plain white/flat-colour style suits the outline best).
2. Run it through Blender to fix origin, size and poly count:

   ```
   blender -b -P tools/blender_prep.py -- path/to/tripo_model.glb hero
   ```

   That writes `public/models/hero.glb` and adds `"hero": "hero.glb"` to `manifest.json`.
3. Reload the game. The ink outline is added automatically.

To do it by hand instead: origin at the feet, facing +Z, sized as in the table, then list the file in `manifest.json`.
Imported models are static (no walk animation yet); skinned meshes get no outline.

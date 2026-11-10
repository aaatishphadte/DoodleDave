# Prepares a Tripo (or any) GLB for the game: joins meshes, puts the origin at the feet,
# scales to a target height, trims heavy meshes, exports to public/models and registers it.
#
#   blender -b -P tools/blender_prep.py -- <input.glb> <slot> [height]
#
# slots: hero (1.6), eraser (0.7), fly (0.6), gem (0.6), star (0.9), exit (2.3)
# The model should face +Z in Blender's glTF import (most Tripo exports do).
# NOTE: written for Blender 4.x; not yet run on this machine (Blender isn't installed here).
import bpy, sys, os, json
from mathutils import Vector

DEFAULT_HEIGHT = {"hero": 1.6, "eraser": 0.7, "fly": 0.6, "gem": 0.6, "star": 0.9, "exit": 2.3}
MAX_TRIS = 20000

args = sys.argv[sys.argv.index("--") + 1:]
src, slot = os.path.abspath(args[0]), args[1]
height = float(args[2]) if len(args) > 2 else DEFAULT_HEIGHT.get(slot, 1.0)
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "models")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("No meshes found in " + src)
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
if tris > MAX_TRIS:
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = MAX_TRIS / tris
    bpy.ops.object.modifier_apply(modifier=mod.name)

corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
scale = height / max(hi.z - lo.z, 1e-6)
obj.scale = (scale, scale, scale)
obj.location = (-(lo.x + hi.x) / 2 * scale, -(lo.y + hi.y) / 2 * scale, -lo.z * scale)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

os.makedirs(out_dir, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, slot + ".glb"), export_format="GLB", use_selection=True)

manifest_path = os.path.join(out_dir, "manifest.json")
manifest = {}
if os.path.exists(manifest_path):
    with open(manifest_path) as f:
        manifest = json.load(f)
manifest[slot] = slot + ".glb"
with open(manifest_path, "w") as f:
    json.dump(manifest, f, indent=2)
print(f"Wrote {slot}.glb at height {height} and registered it in manifest.json")

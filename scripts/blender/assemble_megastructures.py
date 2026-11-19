# Assembles the megastructure models from downloaded third-party parts. Nothing is modelled here:
# parts are imported, trimmed to the pieces wanted, placed and grouped into construction stages.
#   npm run candidates:fetch -- q-ultimate-space-kit k-space-kit kaykit-space-base nasa-3d
#   blender -b -P scripts/blender/assemble_megastructures.py -- [out_dir] [only,names]
# Sources (see scripts/candidate-sources.json):
#   Quaternius   - Ultimate Space Kit (CC0): trusses, transit tubes, domes, habitats, antennas
#   Kenney       - Space Kit (CC0): structural frames, turrets, fuel tanks, generators
#   Kay Lousberg - KayKit Space Base Bits (CC0): tall frames, lights
#   NASA         - 3D Resources (public domain): DSN 70 m dish, TDRS antennas and arrays, ISS arrays, solar sail
# Each part is imported once and placed as linked copies (shared meshes), so a structure of
# hundreds of parts stays small. Every construction stage is a node "stage_<n>"; the game shows
# completed stages and draws the stage under construction as a scaffold.
import bpy, bmesh, sys, os, math, glob, mathutils

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT = os.getcwd()
OUT = ARGS[0] if ARGS else os.path.join(ROOT, 'public/assets/models/mega')
ONLY = set(ARGS[1].split(',')) if len(ARGS) > 1 else None
CAND = os.path.join(ROOT, 'dev-assets/candidates')
os.makedirs(OUT, exist_ok=True)

NASA = 'nasa-3d'
# key: (pack, file, options)
#   objects  - keep only these mesh nodes        material - keep only faces whose material name contains this
#   loose    - 'largest': keep the largest loose piece     align - 'x': turn the longest axis onto X
#   hull     - re-skin with the shared hull material (unifies kits with different palettes)
#   decimate - face ratio to keep
PARTS = {
    # Quaternius Ultimate Space Kit
    'q_truss': ('q-ultimate-space-kit', 'Metal Support.glb', {'align': 'x'}),
    'q_dome': ('q-ultimate-space-kit', 'Geodesic Dome.glb', {}),
    'q_antenna': ('q-ultimate-space-kit', 'Roof Antenna.glb', {}),
    'q_tube': ('q-ultimate-space-kit', 'Connector.glb', {'align': 'x'}),
    'q_base': ('q-ultimate-space-kit', 'Base Large.glb', {}),
    'q_bldg_l': ('q-ultimate-space-kit', 'Building L.glb', {}),
    'q_cyl': ('q-ultimate-space-kit', 'House Cylinder.glb', {}),
    # Kenney Space Kit (re-skinned to the hull palette)
    'k_frame': ('k-space-kit', 'structure_diagonal.glb', {'hull': True}),
    'k_turret': ('k-space-kit', 'turret_double.glb', {'hull': True}),
    'k_tank': ('k-space-kit', 'rocket_fuelA.glb', {'hull': True}),
    'k_gen': ('k-space-kit', 'machine_generatorLarge.glb', {'hull': True}),
    'k_hangar': ('k-space-kit', 'hangar_roundGlass.glb', {}),
    # KayKit Space Base Bits
    'kk_tower': ('kaykit-space-base', 'structure_tall.gltf', {'hull': True}),
    'kk_lights': ('kaykit-space-base', 'lights.gltf', {}),
    'kk_solar': ('kaykit-space-base', 'solarpanel.gltf', {}),
    # NASA 3D Resources (public domain spacecraft hardware)
    'n_dish': (NASA, 'Deep Space Network 70-meter.glb', {'objects': ['dish', 'dish.001', 'dish.002', 'truss_dish', 'collector', 'quad'], 'decimate': 0.5}),
    'n_umbrella': (NASA, 'Tracking and Data Relay Satellites (TDRS) (C) (left antenna).glb', {}),
    'n_sail': (NASA, 'Solar Sail Concept.glb', {'decimate': 0.08}),
}

_hull = None
def hull_material():
    global _hull
    if _hull is None or _hull.name not in bpy.data.materials:
        _hull = bpy.data.materials.new('hull'); _hull.use_nodes = True
        b = _hull.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (0.42, 0.44, 0.48, 1); b.inputs['Metallic'].default_value = 0.65; b.inputs['Roughness'].default_value = 0.42
    return _hull

def find(pack, name):
    hits = glob.glob(os.path.join(CAND, pack, '**', name), recursive=True)
    if not hits: raise SystemExit(f'missing part {pack}/{name}: run npm run candidates:fetch -- {pack}')
    return sorted(hits, key=lambda h: ('GLTF' not in h, len(h)))[0]

def _select(objs, active):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active

def _edit(fn):
    bpy.ops.object.mode_set(mode='EDIT'); fn(); bpy.ops.object.mode_set(mode='OBJECT')

_lib = {}
def lib(key):
    """Import a part once: trimmed to the wanted pieces, joined, centred, scaled to a unit longest side."""
    if key in _lib: return _lib[key]
    pack, name, opt = PARTS[key]
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=find(pack, name))
    new_names = [o.name for o in bpy.data.objects if o.name not in before]
    meshes = [bpy.data.objects[n] for n in new_names if bpy.data.objects[n].type == 'MESH']
    if 'objects' in opt: meshes = [o for o in meshes if o.name in opt['objects']]
    _select(meshes, meshes[0])
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    for n in new_names:
        x = bpy.data.objects.get(n)
        if x is not None and n != o.name: bpy.data.objects.remove(x)
    _select([o], o)
    if 'material' in opt:
        keep = {i for i, m in enumerate(o.data.materials) if m and opt['material'].lower() in m.name.lower()}
        _edit(lambda: bpy.ops.mesh.select_all(action='DESELECT'))
        for f in o.data.polygons: f.select = f.material_index not in keep
        _edit(lambda: bpy.ops.mesh.delete(type='FACE'))
    if opt.get('loose') == 'largest':
        # keep the connected piece with the largest surface (bmesh flood fill; separating thousands of
        # loose pieces into objects is far too slow)
        bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
        seen, best = set(), (0.0, [])
        for f0 in bm.faces:
            if f0.index in seen: continue
            stack, comp = [f0], []
            seen.add(f0.index)
            while stack:
                f = stack.pop(); comp.append(f)
                for e in f.edges:
                    for g in e.link_faces:
                        if g.index not in seen: seen.add(g.index); stack.append(g)
            a = sum(f.calc_area() for f in comp)
            if a > best[0]: best = (a, comp)
        keep = {f.index for f in best[1]}
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
        bm.to_mesh(o.data); bm.free()
    if 'decimate' in opt:
        m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = opt['decimate']
        bpy.ops.object.modifier_apply(modifier='dec')
    if opt.get('hull'):
        o.data.materials.clear(); o.data.materials.append(hull_material())
    o.location = (0, 0, 0)
    pts = [mathutils.Vector(c) for c in o.bound_box]
    lo = mathutils.Vector([min(p[k] for p in pts) for k in range(3)]); hi = mathutils.Vector([max(p[k] for p in pts) for k in range(3)])
    M = mathutils.Matrix.Translation(-(lo + hi) / 2)
    d = hi - lo
    if opt.get('align') == 'x':
        ax = max(range(3), key=lambda k: d[k])
        if ax == 1: M = mathutils.Matrix.Rotation(-math.pi / 2, 4, 'Z') @ M
        elif ax == 2: M = mathutils.Matrix.Rotation(math.pi / 2, 4, 'Y') @ M
    o.data.transform(mathutils.Matrix.Scale(1 / max(d), 4) @ M)
    o.data.update()
    o.data.name = key; o.name = f'lib_{key}'
    for c in o.users_collection: c.objects.unlink(o)
    _lib[key] = o
    return o

_stages = {}
def stage(n):
    if n not in _stages:
        e = bpy.data.objects.new(f'stage_{n}', None)
        bpy.context.scene.collection.objects.link(e)
        _stages[n] = e
    return _stages[n]

def place(key, n, loc=(0, 0, 0), rot=(0, 0, 0), size=1.0, stretch=(1, 1, 1)):
    """A linked copy of a part in stage n. Blender is Z-up; glTF export converts to Y-up."""
    src = lib(key)
    o = src.copy()  # shares the mesh
    o.name = f'{key}.{len(bpy.data.objects)}'
    bpy.context.scene.collection.objects.link(o)
    o.parent = stage(n)
    o.location = loc
    o.rotation_mode = 'XYZ'  # glTF imports default to quaternions, which would ignore rotation_euler
    o.rotation_euler = rot
    o.scale = (size * stretch[0], size * stretch[1], size * stretch[2])
    return o

def around(n_items, R, fn, z=0.0, phase=0.0):
    for i in range(n_items):
        a = phase + i / n_items * math.tau
        fn(i, a, (math.cos(a) * R, math.sin(a) * R, z))

def reset():
    global _hull
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _lib.clear(); _stages.clear(); _hull = None

def shrink_textures(limit=512):
    for im in bpy.data.images:
        if im.size[0] > limit or im.size[1] > limit:
            k = limit / max(im.size)
            im.scale(max(1, int(im.size[0] * k)), max(1, int(im.size[1] * k)))

def export(name):
    shrink_textures()
    bpy.ops.object.select_all(action='DESELECT')
    for e in _stages.values():
        e.select_set(True)
        for c in e.children_recursive: c.select_set(True)
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False, export_image_format='AUTO', export_jpeg_quality=85)
    print(f'{name}: {os.path.getsize(path) / 1e6:.2f} MB, {sum(len(e.children) for e in _stages.values())} parts')

# ---------------------------------------------------------------- structures
# Blender axes: Z up. The game turns some models (see src/ui/render/megastructures3d.ts).

def ring(n, R, key, st, size, z=0.0, phase=0.0, stretch=(1, 1, 1), plane='xy'):
    """Parts laid end to end round a circle (their long axis on the tangent)."""
    def put(i, a, p):
        if plane == 'xy': place(key, st, (p[0], p[1], z), (0, 0, a + math.pi / 2), size, stretch)
        else: place(key, st, (p[0], z, p[1]), (0, -a - math.pi / 2, 0), size, stretch)
    around(n, R, put, phase=phase)

def wing(st, loc, a, n=4, size=1.0, tilt=0.0):
    """A solar wing: n KayKit panels in a row along direction a (in the XY plane) from loc."""
    for k in range(n):
        r = (k + 0.5) * size * 1.02
        place('kk_solar', st, (loc[0] + math.cos(a) * r, loc[1] + math.sin(a) * r, loc[2]), (tilt, 0, a), size)

def dyson_panel():
    # a solar-sail statite; its sail faces +Y here (+Z in glTF), which the game turns to the star
    place('n_sail', 1, rot=(0, 0, math.pi / 2))

def lattice_relay():
    place('n_umbrella', 1, (0, 0, 0.25), (0, 0, 0), 1.0)
    for s in (0, math.pi):
        wing(1, (0, 0, -0.3), s, n=2, size=0.35)

def orbital_ring():
    R = 10
    # stage 1: the ring, transit tubes end to end, with a second rail below
    ring(40, R, 'q_tube', 1, 1.7)
    ring(40, R, 'q_tube', 1, 1.7, z=-0.7, phase=math.pi / 40)
    # stage 2: radial truss spokes to habitat hubs
    around(6, R / 2, lambda i, a, p: place('q_truss', 2, p, (0, 0, a), R * 0.92))
    around(8, R, lambda i, a, p: place('q_base', 2, (p[0], p[1], 0.75), (0, 0, a + math.pi / 2), 2.0))
    # stage 3: solar wings outboard, domes and relay antennas
    around(16, R + 0.9, lambda i, a, p: wing(3, p, a, n=3, size=0.8), phase=math.pi / 16)
    around(8, R, lambda i, a, p: place('q_dome', 3, (p[0], p[1], 1.0), (0, 0, a), 1.0), phase=math.pi / 8)
    around(4, R, lambda i, a, p: place('n_umbrella', 3, (p[0], p[1], -1.8), (math.pi, 0, a), 1.6), phase=math.pi / 4)

def bastion():
    # stage 1: twin habitat core on armoured frames
    place('q_base', 1, (0, 0, 0.6), size=3.6)
    place('q_base', 1, (0, 0, -0.6), (math.pi, 0, 0), 3.6)
    around(4, 2.0, lambda i, a, p: place('kk_tower', 1, (p[0], p[1], 0), (0, 0, a), 2.4), phase=math.pi / 4)
    # stage 2: gun batteries round the rim, top and bottom
    around(6, 2.6, lambda i, a, p: place('k_turret', 2, (p[0], p[1], 1.0), (0, 0, a - math.pi / 2), 1.0))
    around(6, 2.6, lambda i, a, p: place('k_turret', 2, (p[0], p[1], -1.0), (math.pi, 0, a - math.pi / 2), 1.0), phase=math.pi / 6)
    # stage 3: sensor mast, heavy guns and power wings
    place('q_antenna', 3, (0, 0, 2.9), size=2.4)
    place('k_turret', 3, (0, 0, 1.9), size=1.5)
    place('k_turret', 3, (0, 0, -1.9), (math.pi, 0, 0), 1.5)
    for a in (0, math.pi): wing(3, (math.cos(a) * 2.6, 0, 0), a, n=4, size=0.9)

def stellar_collector():
    # stage 1: spine and power plant; the dish faces +X (the game turns +X to the star)
    place('q_truss', 1, (-2.0, 0, 0), size=6.0)
    place('q_truss', 1, (-2.0, 0, 0), (math.pi / 2, 0, 0), 6.0)
    place('k_gen', 1, (-5.2, 0, 0), (0, math.pi / 2, 0), 1.6)
    # stage 2: the collector dish
    place('n_dish', 2, (1.0, 0, 0), (0, math.pi / 2, 0), 5.5)
    # stage 3: radiator wings along the spine
    for k in range(3):
        for a in (math.pi / 2, -math.pi / 2):
            wing(3, (-1.4 - k * 1.25, 0, 0), a, n=3, size=1.1)

def hypergate():
    R = 5
    # the gate stands in the XZ plane; ships pass along Y
    # stage 1: torus of transit tubes, doubled
    ring(32, R, 'q_tube', 1, 1.05, plane='xz')
    ring(32, R + 0.55, 'q_tube', 1, 1.1, plane='xz', phase=math.pi / 32)
    # stage 2: structural frames round the outside
    around(12, R + 1.3, lambda i, a, p: place('k_frame', 2, (p[0], 0, p[1]), (0, -a, 0), 1.2))
    # stage 3: field emitters (antennas aimed inwards) and power plants
    around(6, R + 2.2, lambda i, a, p: place('n_umbrella', 3, (p[0], 0, p[1]), (0, -a + math.pi / 2, 0), 1.6))
    around(6, R + 2.0, lambda i, a, p: place('k_gen', 3, (p[0], 0, p[1]), (0, -a + math.pi / 2, 0), 1.2), phase=math.pi / 6)

def grand_archive():
    # stage 1: foundations
    place('q_base', 1, (0, 0, 0), size=4.2)
    around(3, 2.8, lambda i, a, p: place('q_bldg_l', 1, (p[0], p[1], -0.3), (0, 0, a), 2.5))
    # stage 2: the great dome and reading halls
    place('q_dome', 2, (0, 0, 1.6), size=3.4)
    around(6, 3.3, lambda i, a, p: place('q_cyl', 2, (p[0], p[1], 0.2), (0, 0, a), 1.15), phase=math.pi / 6)
    # stage 3: the beacon antenna above, a dish below
    place('n_umbrella', 3, (0, 0, 4.0), size=2.4)
    place('q_antenna', 3, (0, 0, 3.4), size=1.6)
    around(6, 3.3, lambda i, a, p: place('kk_lights', 3, (p[0], p[1], 1.2), (0, 0, a), 0.8))

def sector_array():
    L = 10
    # stage 1: cross truss with a control hub
    for a in (0, math.pi / 2):
        place('q_truss', 1, (0, 0, 0), (0, 0, a), L)
    place('k_hangar', 1, (0, 0, 0.3), size=1.8)
    # stage 2: antennas along the arms, aimed out
    for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
        for r in (2.0, 3.8):
            place('n_umbrella', 2, (math.cos(a) * r, math.sin(a) * r, 0.8), (0, 0, a), 1.5)
    # stage 3: the great dish at the hub and power wings at the tips
    place('n_dish', 3, (0, 0, 2.2), (0, 0, 0), 4.0)
    around(4, L / 2, lambda i, a, p: wing(3, p, a, n=3, size=1.1))

def continuum_engine():
    # stage 1: reactor column of stacked tanks inside a frame
    for z in (-1.4, 0, 1.4):
        place('k_tank', 1, (0, 0, z), size=1.7)
    around(4, 1.7, lambda i, a, p: place('kk_tower', 1, p, (0, 0, a), 2.6))
    # stage 2: three containment rings of tubes
    for z, R in ((-1.5, 2.4), (0, 2.9), (1.5, 2.4)):
        ring(18, R, 'q_tube', 2, R * 0.42, z=z)
    # stage 3: generators and radiator wings
    around(6, 3.0, lambda i, a, p: place('k_gen', 3, (p[0], p[1], 0), (0, 0, a), 1.0), phase=math.pi / 6)
    around(6, 3.4, lambda i, a, p: wing(3, p, a, n=3, size=0.9, tilt=math.pi / 2))

BUILDERS = {
    'dyson_panel': dyson_panel, 'lattice_relay': lattice_relay, 'orbital_ring': orbital_ring, 'bastion': bastion,
    'stellar_collector': stellar_collector, 'hypergate': hypergate, 'grand_archive': grand_archive,
    'sector_array': sector_array, 'continuum_engine': continuum_engine,
}
for name, fn in BUILDERS.items():
    if ONLY and name not in ONLY: continue
    reset(); fn(); export(name)

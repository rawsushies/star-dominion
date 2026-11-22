# Assembles the capital megacity kit from downloaded third-party parts. Nothing is modelled here:
# parts are imported (appended from .blend files or glTF), placed and grouped into models.
#   npm run candidates:fetch -- alien-buildings-ext industrial-tanks industrial-chimneys q-scifi-megakit k-city-roads neon-town
#   blender -b -P scripts/blender/assemble_megacity.py -- [out_dir]
# Sources (all CC0, see scripts/candidate-sources.json):
#   rubberduck  - Alien building/base set + extension pack: fortresses, drums, towers, generators,
#                 walls, gates, corridors, pipes. Their green accents are recoloured to imperial gold.
#   rubberduck  - Industrial extension packs 1 (tanks) and 3 (chimneys)
#   Quaternius  - Modular Sci-Fi MegaKit: structural columns, truss columns, platforms (floor slabs)
#   Kenney      - City Kit Roads: highway decks, crossings, bridge pillars, lights
#   Darkvinter  - Neon Town: the car and taxi used for street traffic
# Kit units: one city plot is 10 x 10 units; Z up (glTF export turns it Y-up).
# Each model is a top-level empty named after the model; parts are linked copies (shared meshes).
import bpy, bmesh, sys, os, math, glob, mathutils
import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT = os.getcwd()
OUT = ARGS[0] if ARGS else os.path.join(ROOT, 'public/assets/models/megacity')
CAND = os.path.join(ROOT, 'dev-assets/candidates')
os.makedirs(OUT, exist_ok=True)

AB = ('alien-buildings-ext', 'alien_buildings.blend')
TK = ('industrial-tanks', 'industrial_tanks.blend')
CH = ('industrial-chimneys', 'chimneys.blend')
MK = 'q-scifi-megakit'
KR = 'k-city-roads'
NT = 'neon-town'
# key: (source, name)   source is a (pack, blend) pair or a glTF pack
PARTS = {
    'fortress': (AB, 'alien_base_big'), 'drum': (AB, 'alien_base3'), 'block_a': (AB, 'alien_base2'), 'block_b': (AB, 'alien_base6'),
    'block_c': (AB, 'alien_base8'), 'block_d': (AB, 'alien_base10'), 'hall_a': (AB, 'alien_base7'), 'hall_b': (AB, 'alien_base9'),
    'works': (AB, 'alien_base1'), 'works_b': (AB, 'alien_base11'), 'vault': (AB, 'alien_base4'), 'module': (AB, 'alien_base5'),
    'tower': (AB, 'alien_tower'), 'tower_dome': (AB, 'alien_tower2'), 'pylon': (AB, 'alien_tower_wall'), 'antenna': (AB, 'alien_antenna'),
    'generator': (AB, 'alien_generator'), 'pipes_up': (AB, 'pipes_up'), 'pipes': (AB, 'pipes_st1'), 'connector': (AB, 'alien_pipe_connector'),
    'wall_long': (AB, 'alien_wall_long'), 'wall_short': (AB, 'alien_wall_short'), 'gate': (AB, 'alien_gate'), 'corridor': (AB, 'alien_corridor'),
    'corridor_end': (AB, 'alien_corridor_end'), 'pad': (AB, 'alien_platform_1'), 'ufo': (AB, 'ufo_stand'),
    'tank_a': (TK, 'tank_1'), 'tank_b': (TK, 'tank_2'), 'chimney': (CH, 'chimney_1_mat'),
    'col_hollow': (MK, 'Column_Hollow.gltf'), 'col_pipes': (MK, 'Column_Pipes.gltf'), 'col_large': (MK, 'Column_Large_Straight.gltf'),
    'slab_round': (MK, 'Platform_Round1.gltf'), 'slab': (MK, 'Platform_DarkPlates.gltf'),
    'road': (KR, 'road-straight-barrier.glb'), 'road_x': (KR, 'road-crossroad-barrier.glb'), 'road_t': (KR, 'road-intersection-barrier.glb'),
    'pillar': (KR, 'bridge-pillar-wide.glb'), 'lamp': (KR, 'light-square-double.glb'),
    'car': (NT, 'car.glb'), 'taxi': (NT, 'taxi.glb'),
}

# heavy parts reduced (face ratio of the original): truss columns 6,480 faces, round slabs 720, hollow cores 2,848
DECIMATE = {'col_pipes': 0.18, 'slab_round': 0.5, 'col_hollow': 0.4}

GOLD = np.array([0.86, 0.64, 0.25])

def find(pack, name):
    hits = glob.glob(os.path.join(CAND, pack, '**', name), recursive=True)
    if not hits: raise SystemExit(f'missing {pack}/{name}: run npm run candidates:fetch -- {pack}')
    return sorted(hits, key=lambda h: ('GLB format' not in h and 'glTF' not in h, len(h)))[0]

def resolve(img, base_dir):
    """Images appended from a .blend keep paths relative to that file ('//x.jpg'); point them at
    the pack's directory and load them now (Blender loads images lazily)."""
    p = img.filepath
    if p.startswith('//'):
        cand = os.path.normpath(os.path.join(base_dir, p[2:]))
        if not os.path.exists(cand): cand = os.path.join(base_dir, os.path.basename(p[2:]))
        if os.path.exists(cand): img.filepath = cand
    try: img.reload(); _ = img.pixels[0]
    except Exception: pass
    return img.has_data

def principled(m, base_dir):
    """The .blend packs use Diffuse BSDF nodes, which glTF cannot carry: rebuild each material as a
    Principled BSDF with the same colour texture (and the pack's normal map when it has one). A
    material whose texture is missing gets a plain steel or concrete colour."""
    if m.get('pbr'): return
    nt = m.node_tree
    tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.has_data and 'norm' not in n.image.name.lower() and 'spec' not in n.image.name.lower()), None)
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
    for n in [n for n in nt.nodes if n.type.startswith('BSDF') or n.type in ('MIX_SHADER', 'ADD_SHADER')]: nt.nodes.remove(n)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface'])
    b.inputs['Metallic'].default_value = 0.55
    b.inputs['Roughness'].default_value = 0.48
    if tex:
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
        stem = os.path.splitext(os.path.basename(bpy.path.abspath(tex.image.filepath)))[0]
        nrm = next((os.path.join(base_dir, f) for f in os.listdir(base_dir) if f.startswith(stem + '_norm')), None)
        if nrm:
            ni = nt.nodes.new('ShaderNodeTexImage'); ni.image = bpy.data.images.load(nrm, check_existing=True); ni.image.colorspace_settings.name = 'Non-Color'
            nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(ni.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    else:
        name = m.name.lower()
        b.inputs['Base Color'].default_value = (0.36, 0.33, 0.3, 1) if ('brick' in name or 'concrete' in name) else (0.42, 0.44, 0.47, 1) if 'red' not in name else (0.45, 0.16, 0.12, 1)
    m['pbr'] = True

def recolour_green(img):
    """Imperial palette: the alien set's lime accents become gold (luminance kept)."""
    if not img.has_data or img.get('recoloured'): return
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h * w, img.channels)
    rgb = px[:, :3]
    green = (rgb[:, 1] > rgb[:, 0] * 1.35) & (rgb[:, 1] > rgb[:, 2] * 1.35) & (rgb[:, 1] > 0.12)
    if green.any():
        lum = rgb[green].max(axis=1, keepdims=True)
        rgb[green] = np.clip(lum * GOLD / GOLD.max() * 1.05, 0, 1)
        px[:, :3] = rgb
        img.pixels[:] = px.ravel()
        img.update()
    img['recoloured'] = True

def normalise_part(o):
    """Apply transforms, centre on X/Y with the base at Z=0."""
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    pts = [mathutils.Vector(c) for c in o.bound_box]
    lo = mathutils.Vector([min(p[k] for p in pts) for k in range(3)]); hi = mathutils.Vector([max(p[k] for p in pts) for k in range(3)])
    o.data.transform(mathutils.Matrix.Translation(mathutils.Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))
    o.location = (0, 0, 0)
    return hi - lo

_lib = {}
def lib(key):
    if key in _lib: return _lib[key]
    src, name = PARTS[key]
    if isinstance(src, tuple):
        path = find(*src)
        with bpy.data.libraries.load(path, link=False) as (data_from, data_to):
            data_to.objects = [name]
        o = data_to.objects[0]
        bpy.context.scene.collection.objects.link(o)
        o.parent = None
        for m in o.data.materials:
            if m and not m.use_nodes: m.use_nodes = True
            if m and m.use_nodes:
                for n in m.node_tree.nodes:
                    if n.type == 'TEX_IMAGE' and n.image and resolve(n.image, os.path.dirname(path)): recolour_green(n.image)
                principled(m, os.path.dirname(path))
    else:
        before = {x.name for x in bpy.data.objects}
        bpy.ops.import_scene.gltf(filepath=find(src, name))
        new = [x for x in bpy.data.objects if x.name not in before]
        meshes = [x for x in new if x.type == 'MESH']
        bpy.ops.object.select_all(action='DESELECT')
        for m in meshes: m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
        if len(meshes) > 1: bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        for x in new:
            if x.name in bpy.data.objects and x != o: bpy.data.objects.remove(x)
        gltf_dir = os.path.dirname(find(src, name))
        for m in o.data.materials:
            if m and m.use_nodes:
                for n in m.node_tree.nodes:
                    if n.type == 'TEX_IMAGE' and n.image and not n.image.packed_file:
                        im = n.image
                        if not os.path.exists(bpy.path.abspath(im.filepath)):
                            # MegaKit glTF files name textures by stem; look in the pack's Textures folder
                            stem = os.path.basename(bpy.path.abspath(im.filepath)) or im.name
                            hits = glob.glob(os.path.join(CAND, src, '**', os.path.splitext(stem.split('.0')[0])[0] + '.*'), recursive=True)
                            if hits: im.filepath = hits[0]
                        try: im.reload(); _ = im.pixels[0]
                        except Exception: pass
    if key.startswith('tank') or key == 'chimney':
        # these packs' painted textures are not included: weathered steel tanks, concrete chimneys
        for m in o.data.materials:
            if not m: continue
            b = m.node_tree.nodes.get('Principled BSDF') or next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not b: continue
            for l in list(b.inputs['Base Color'].links): m.node_tree.links.remove(l)
            b.inputs['Base Color'].default_value = (0.2, 0.19, 0.18, 1) if key == 'chimney' else (0.16, 0.17, 0.19, 1)
            b.inputs['Metallic'].default_value = 0.05 if key == 'chimney' else 0.2
            b.inputs['Roughness'].default_value = 0.7 if key == 'chimney' else 0.45
    if key in DECIMATE:
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new('dec', 'DECIMATE'); mod.ratio = DECIMATE[key]
        bpy.ops.object.modifier_apply(modifier='dec')
    size = normalise_part(o)
    o.name = f'lib_{key}'; o.data.name = key
    o['size'] = tuple(size)
    for c in o.users_collection: c.objects.unlink(o)
    _lib[key] = o
    return o

def dims(key): return mathutils.Vector(lib(key)['size'])

_models = {}
def model(name):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    _models[name] = e
    return e

def put(parent, key, loc=(0, 0, 0), rz=0.0, fit=None, h=None, s=None, stretch=(1, 1, 1)):
    """Place a linked copy. fit = target footprint (longest horizontal side); h = target height; s = scale."""
    src = lib(key); d = dims(key)
    k = s if s is not None else (fit / max(d.x, d.y) if fit else h / d.z if h else 1.0)
    o = src.copy()
    o.name = f'{key}.{len(bpy.data.objects)}'
    bpy.context.scene.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    o.rotation_mode = 'XYZ'; o.rotation_euler = (0, 0, rz)
    o.scale = (k * stretch[0], k * stretch[1], k * stretch[2])
    return o, d * k

def top(key, k): return dims(key).z * k

# ---------------------------------------------------------------- models (one plot = 10 x 10)

def arcology(name, floors, crown='tower_dome', twist=0.0):
    """A steel arcology: a hollow structural core wrapped in round floor slabs, drums at the base
    and mid-height, and a crown."""
    m = model(name)
    _, d = put(m, 'drum', fit=8.5)
    z = d.z
    core_h = floors * 4.2
    put(m, 'col_hollow', (0, 0, z), h=core_h, stretch=(0.35, 0.35, 1))
    for i in range(floors):
        put(m, 'slab_round', (0, 0, z + i * 4.2 + 3.6), rz=twist * i, fit=7.2 - 1.2 * (i % 2))
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        o, dd = put(m, 'col_pipes', (math.cos(ang) * 3.3, math.sin(ang) * 3.3, z), h=core_h * 0.92)
        k = 0.9 / max(dims('col_pipes').x, dims('col_pipes').y) / o.scale.z  # keep the truss slender
        o.scale = (o.scale.x * k, o.scale.y * k, o.scale.z)
    put(m, 'drum', (0, 0, z + core_h * 0.55), fit=5.6)
    put(m, crown, (0, 0, z + core_h), fit=5.0)
    return m

def spire(name, h=30):
    m = model(name)
    _, d = put(m, 'vault', fit=8)
    _, p = put(m, 'pylon', (0, 0, d.z * 0.6), h=h * 0.6)
    put(m, 'pylon', (0, 0, d.z * 0.6 + p.z * 0.98), h=h * 0.4, s=None)
    put(m, 'antenna', (0, 0, d.z * 0.6 + p.z * 0.98 + h * 0.4), fit=3)
    return m

def truss_tower(name, h=34):
    m = model(name)
    _, d = put(m, 'module', fit=8)
    put(m, 'col_pipes', (0, 0, d.z * 0.8), h=h, stretch=(0.5, 0.5, 1))
    put(m, 'connector', (0, 0, d.z * 0.8 + h), fit=4)
    put(m, 'antenna', (0, 0, d.z * 0.8 + h + 3), fit=3)
    return m

def block(name, base, upper=None, h=None):
    m = model(name)
    _, d = put(m, base, fit=9)
    if upper:
        put(m, upper, (0, 0, d.z * 0.92), fit=6.5)
    return m

def stack(name, parts):
    """Blocks stacked vertically, each narrower than the last."""
    m = model(name)
    z = 0
    for key, fit, rz in parts:
        _, d = put(m, key, (0, 0, z), rz=rz, fit=fit)
        z += d.z * 0.95
    return m

def works(name):
    m = model(name)
    put(m, 'works', (-1.2, 0, 0), fit=7)
    put(m, 'tank_b', (3.4, 2.8, 0), h=9)
    put(m, 'tank_a', (3.6, -2.4, 0), h=6)
    put(m, 'chimney', (-3.8, -3.6, 0), h=16)
    put(m, 'chimney', (-2.4, -3.8, 0), h=13)
    return m

def refinery(name):
    m = model(name)
    put(m, 'works_b', (0, 1.2, 0), fit=7.5)
    for i, (x, y) in enumerate([(-3.5, -3.4), (-1.2, -3.6), (1.1, -3.5)]):
        put(m, 'tank_a', (x, y, 0), h=6 + i)
    put(m, 'chimney', (3.8, -3.6, 0), h=18)
    put(m, 'pipes', (0, -1.6, 0), rz=math.pi / 2, fit=8)
    return m

def power_plant(name):
    m = model(name)
    put(m, 'generator', (0, 0.8, 0), fit=8)
    put(m, 'pipes_up', (0, -2.6, 0), rz=math.pi / 2, fit=7)
    put(m, 'tank_b', (-3.6, -3.4, 0), h=10)
    put(m, 'tank_b', (3.6, -3.4, 0), h=10)
    put(m, 'pylon', (0, 4.2, 0), h=14)
    return m

def yard(name):
    m = model(name)
    put(m, 'pad', fit=9.5)
    put(m, 'gate', (0, 3.6, 0.6), fit=8)
    put(m, 'ufo', (0, -0.8, 0.8), fit=5.5)
    return m

def bastion(name):
    m = model(name)
    put(m, 'wall_short', (0, 0, 0), fit=9)
    put(m, 'pylon', (-4.4, 0, 0), h=11)
    put(m, 'pylon', (4.4, 0, 0), h=11)
    put(m, 'tower', (0, -3, 0), h=10)
    return m

def citadel(tier):
    """The Imperial Citadel, sized for a 2 x 2 plot area (20 x 20). Grows with tier."""
    m = model(f'citadel_t{tier}')
    _, d = put(m, 'fortress', fit=16 + tier)
    z = d.z * 0.82
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        put(m, 'pylon', (math.cos(ang) * (8 + tier * 0.5), math.sin(ang) * (8 + tier * 0.5), 0), h=10 + tier * 5)
    if tier >= 2:
        put(m, 'drum', (0, 0, z), fit=7.5)
        put(m, 'col_hollow', (0, 0, z + 6), h=10 + tier * 6, stretch=(0.4, 0.4, 1))
        for i in range(2 + tier * 2):
            put(m, 'slab_round', (0, 0, z + 8 + i * 3.4), fit=6.5 if i % 2 else 5.2)
    if tier >= 3:
        for a in range(4):
            ang = a * math.pi / 2
            put(m, 'tower', (math.cos(ang) * 5.5, math.sin(ang) * 5.5, z * 0.9), h=14 + tier * 3)
    crown_z = z + (6 + 10 + tier * 6 if tier >= 2 else 0)
    put(m, 'tower_dome' if tier >= 2 else 'antenna', (0, 0, crown_z), fit=5 + tier)
    if tier >= 4:
        put(m, 'antenna', (0, 0, crown_z + dims('tower_dome').z * (5 + tier) / max(dims('tower_dome').x, dims('tower_dome').y)), fit=4)
    return m

def transit(name, junction=False):
    """An elevated transit section, 10 units long on X: a sealed corridor tube (or a junction
    hub) carried on a pylon. The city's highways are built from these."""
    m = model(name)
    if junction:
        _, d = put(m, 'corridor_end', (0, 0, 5.2), fit=6.5)
    else:
        o, d = put(m, 'corridor', (0, 0, 5.6), fit=10)
        o.scale = (o.scale.x, o.scale.y * 0.55, o.scale.z * 0.55)
    put(m, 'pylon', (0, 0, 0), h=6.0, stretch=(0.7, 0.7, 1))
    return m

def simple(name, key, **kw):
    m = model(name)
    put(m, key, **kw)
    return m

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for t in (1, 2, 3, 4): citadel(t)
    arcology('arco_a', 6); arcology('arco_b', 9, twist=0.2); arcology('arco_c', 13, crown='tower', twist=0.35)
    spire('spire_a', 26); spire('spire_b', 38)
    truss_tower('truss_a', 30)
    stack('res_a', [('block_a', 9, 0), ('block_b', 6.5, math.pi / 2)])
    stack('res_b', [('block_c', 8.5, 0), ('drum', 5.5, 0)])
    stack('res_c', [('hall_b', 9, 0), ('block_d', 6.5, 0)])
    block('hall_a', 'hall_a'); block('hall_b', 'block_d', 'antenna'); block('vault', 'vault', 'module')
    works('works_a'); refinery('refinery_a'); power_plant('power_a'); yard('yard_a'); bastion('bastion_a')
    transit('hwy_straight'); transit('hwy_cross', junction=True); transit('hwy_t', junction=True)
    simple('skybridge', 'corridor', fit=10)
    simple('lamp', 'lamp', h=3)
    simple('wall', 'wall_long', fit=10)
    simple('gate', 'gate', fit=10)
    # street traffic, at the packs' own scale (a car is about 4.3 units long)
    simple('car', 'car'); simple('taxi', 'taxi')
    # textures: colour maps at 1024, everything else at 512
    for im in bpy.data.images:
        try: _ = im.pixels[0]  # force the lazy load
        except Exception: pass
        if not im.has_data or not im.size[0]: continue
        lim = 256 if any(k in im.name.lower() for k in ('norm', 'spec', 'orm', 'rough', 'ao')) else 512
        if max(im.size) > lim:
            k = lim / max(im.size); im.scale(max(1, int(im.size[0] * k)), max(1, int(im.size[1] * k)))
    bpy.ops.object.select_all(action='DESELECT')
    for e in _models.values():
        e.select_set(True)
        for c in e.children_recursive: c.select_set(True)
    path = os.path.join(OUT, 'kit.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False, export_image_format='JPEG', export_jpeg_quality=82)
    print(f'kit: {os.path.getsize(path) / 1e6:.2f} MB, {len(_models)} models: {", ".join(_models)}')
    for n, e in _models.items():
        pts = [c.matrix_world @ mathutils.Vector(b) for c in e.children for b in c.bound_box]
        hi = max(p.z for p in pts); w = max(max(p.x for p in pts) - min(p.x for p in pts), max(p.y for p in pts) - min(p.y for p in pts))
        print(f'  {n:14s} width {w:5.1f} height {hi:5.1f} parts {len(e.children)}')

build()

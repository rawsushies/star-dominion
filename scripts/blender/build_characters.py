# Builds the character models from Quaternius' free Standard packs (all CC0):
#   Universal Base Characters, Modular Character Outfits - Fantasy, Universal Animation Library 1 and 2.
#   npm run candidates:fetch -- q-universal-base-characters q-outfits-fantasy q-universal-animation q-universal-animation-2
#   blender -b -P scripts/blender/build_characters.py -- [out_dir]
# Nothing is modelled. Every pack shares one 65-bone humanoid skeleton with identical rest poses
# (checked: same bone names, translations and rotations), so:
#   chars2/male.glb, chars2/female.glb - the base head (body faces under clothing removed), every
#       modular outfit part, the hairstyles, beard and eyebrows, all skinned to one armature. The game
#       shows the parts an archetype calls for and hides the rest.
#   chars2/anims.glb - an armature with the chosen clips from both animation libraries, shared by
#       every character (three.js binds tracks by bone name).
import bpy, sys, os, glob

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT = os.getcwd()
OUT = ARGS[0] if ARGS else os.path.join(ROOT, 'public/assets/models/chars2')
CAND = os.path.join(ROOT, 'dev-assets/candidates')
os.makedirs(OUT, exist_ok=True)

def one(pattern):
    hits = sorted(glob.glob(os.path.join(CAND, pattern), recursive=True), key=len)
    if not hits: raise SystemExit(f'missing {pattern}: run npm run candidates:fetch')
    return hits[0]

UBC = 'q-universal-base-characters/**/'
OUTFIT = 'q-outfits-fantasy/**/Modular Parts/'
HAIR = UBC + 'Rigged to Head Bone/**/'

CLIPS = {
    # UAL 1 (Unreal FBX)
    'Idle_Loop': 'idle', 'Idle_Talking_Loop': 'talk', 'Walk_Formal_Loop': 'walk_formal', 'Walk_Loop': 'walk',
    'Pistol_Idle_Loop': 'pistol_idle', 'Pistol_Shoot': 'pistol_shoot', 'Pistol_Aim_Neutral': 'pistol_aim',
    'Sword_Idle': 'sword_idle', 'Sword_Attack': 'sword_attack', 'Spell_Simple_Idle_Loop': 'command_idle',
    'Spell_Simple_Shoot': 'command', 'Interact': 'interact', 'Sitting_Idle_Loop': 'sit', 'Sitting_Talking_Loop': 'sit_talk',
    'Hit_Chest': 'hit', 'Death01': 'death', 'Punch_Jab': 'jab',
    # UAL 2 (glTF)
    'Idle_FoldArms_Loop': 'fold_arms', 'Yes': 'yes', 'Idle_No_Loop': 'no', 'Idle_TalkingPhone_Loop': 'comms',
    'Idle_Shield_Loop': 'guard', 'Sword_Regular_Combo': 'sword_combo', 'Idle_Rail_Call': 'hail',
}

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def imported(fn):
    before = {o.name for o in bpy.data.objects}
    fn()
    return [o for o in bpy.data.objects if o.name not in before]

def fix_image_paths():
    """Some pack .gltf files name textures '<name>_png.png' while the file on disk is '<name>.png'."""
    for im in bpy.data.images:
        p = bpy.path.abspath(im.filepath)
        if p and not os.path.exists(p) and p.endswith('_png.png') and os.path.exists(p[:-8] + '.png'):
            im.filepath = p[:-8] + '.png'; im.reload()

def shrink_textures(limit, detail_limit=None):
    """Colour maps to `limit`; normal, roughness and ORM maps to `detail_limit`."""
    for im in bpy.data.images:
        lim = detail_limit if detail_limit and any(k in im.name for k in ('Normal', 'ORM', 'Roughness')) else limit
        if im.size[0] > lim:
            im.scale(lim, int(im.size[1] * lim / im.size[0]))

# ---------------------------------------------------------------- characters

def adopt(objs, arm, name):
    """Re-target the meshes of an imported part onto the shared armature; drop the part's own armature."""
    meshes = [o for o in objs if o.type == 'MESH']
    for i, m in enumerate(meshes):
        mw = m.matrix_world.copy()
        m.parent = arm
        m.matrix_world = mw
        for mod in m.modifiers:
            if mod.type == 'ARMATURE': mod.object = arm
        m.name = name if len(meshes) == 1 else f'{name}_{i}'
    for o in objs:
        if o.type != 'MESH' and o.name in bpy.data.objects: bpy.data.objects.remove(o)
    return meshes

def head_only(mesh, keep=('Head', 'neck_01')):
    """Keep only the faces of the base body that are mostly weighted to the head and neck bones."""
    idx = {g.index for g in mesh.vertex_groups if g.name in keep}
    good = set()
    for v in mesh.data.vertices:
        w = sum(g.weight for g in v.groups if g.group in idx)
        if w > 0.5: good.add(v.index)
    import bmesh
    bm = bmesh.new(); bm.from_mesh(mesh.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(v.index in good for v in f.verts)], context='FACES')
    bm.to_mesh(mesh.data); bm.free()

def build_character(sex):
    reset()
    M = sex == 'Male'
    body = imported(lambda: bpy.ops.import_scene.gltf(filepath=one(UBC + f'Superhero_{sex}_FullBody.gltf')))
    arm = [o for o in body if o.type == 'ARMATURE'][0]
    arm.name = 'Rig'
    for m in [o for o in body if o.type == 'MESH']:
        if 'eye' in m.name.lower(): m.name = 'eyes'; continue
        head_only(m); m.name = 'head'
    parts = {
        'ranger_body': f'{sex}_Ranger_Body', 'ranger_arms': f'{sex}_Ranger_Arms', 'ranger_legs': f'{sex}_Ranger_Legs',
        'ranger_feet': f'{sex}_Ranger_Feet_Boots' if M else f'{sex}_Ranger_Feet', 'ranger_hood': f'{sex}_Ranger_Head_Hood',
        'ranger_pauldron': f'{sex}_Ranger_Acc_Pauldron' if M else f'{sex}_Ranger_Acc_Pauldrons',
        'peasant_body': f'{sex}_Peasant_Body', 'peasant_arms': f'{sex}_Peasant_Arms', 'peasant_legs': f'{sex}_Peasant_Legs', 'peasant_feet': f'{sex}_Peasant_Feet',
    }
    for key, file in parts.items():
        adopt(imported(lambda: bpy.ops.import_scene.gltf(filepath=one(OUTFIT + f'{file}.gltf'))), arm, key)
    hair = ['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale'] + (['Hair_Beard', 'Eyebrows_Regular'] if M else ['Eyebrows_Female'])
    for h in hair:
        adopt(imported(lambda: bpy.ops.import_scene.gltf(filepath=one(HAIR + f'{h}.gltf'))), arm, h.lower())
    # no animation on the body files: clips come from anims.glb
    for a in list(bpy.data.actions): bpy.data.actions.remove(a)
    fix_image_paths()
    shrink_textures(1024, 512)
    path = os.path.join(OUT, f'{sex.lower()}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_animations=False, export_image_format='WEBP', export_image_quality=82)
    print(f'{sex}: {os.path.getsize(path) / 1e6:.2f} MB, meshes {sorted(o.name for o in bpy.data.objects if o.type == "MESH")}')

# ---------------------------------------------------------------- animations

def build_anims():
    reset()
    objs = imported(lambda: bpy.ops.import_scene.gltf(filepath=one('q-universal-animation-2/**/UAL2_Standard.glb')))
    arm = [o for o in objs if o.type == 'ARMATURE'][0]
    arm.name = 'Rig'
    for o in objs:
        if o.type == 'MESH': bpy.data.objects.remove(o)
    fbx = imported(lambda: bpy.ops.import_scene.fbx(filepath=one('q-universal-animation/**/AL_Standard.fbx')))
    for o in fbx: bpy.data.objects.remove(o)
    # identical skeletons and rest poses: an action from either library drives this armature by bone name
    chosen = []
    for act in list(bpy.data.actions):
        base = act.name.split('|')[-1].removesuffix('_Armature')
        if base in CLIPS and CLIPS[base] not in [c.name for c in chosen]:
            act.name = CLIPS[base]; chosen.append(act)
        else:
            bpy.data.actions.remove(act)
    arm.animation_data_create()
    arm.animation_data.action = None
    for act in chosen:
        t = arm.animation_data.nla_tracks.new(); t.name = act.name
        t.strips.new(act.name, int(act.frame_range[0]), act.action if hasattr(act, 'action') else act)
    missing = sorted(set(CLIPS.values()) - {c.name for c in chosen})
    path = os.path.join(OUT, 'anims.glb')
    bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animation_mode='NLA_TRACKS', export_skins=True)
    print(f'anims: {os.path.getsize(path) / 1e6:.2f} MB, {len(chosen)} clips, missing {missing}')

# ---------------------------------------------------------------- hand props

def build_props():
    """Sidearms from Quaternius Sci-Fi Essentials (CC0), one node each, grip roughly at the origin."""
    reset()
    for name in ['Gun_Pistol', 'Gun_Revolver', 'Gun_Rifle']:
        objs = imported(lambda: bpy.ops.import_scene.gltf(filepath=one(f'q-sci-fi-essentials/**/glTF/{name}.gltf')))
        names = [o.name for o in objs]
        meshes = [o for o in objs if o.type == 'MESH']
        bpy.ops.object.select_all(action='DESELECT')
        for m in meshes: m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        if len(meshes) > 1: bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        for n in names:
            x = bpy.data.objects.get(n)
            if x is not None and n != o.name: bpy.data.objects.remove(x)
        o.name = name.lower().replace('gun_', 'prop_')
        print(o.name, tuple(round(d, 3) for d in o.dimensions))
    shrink_textures(512)
    path = os.path.join(OUT, 'props.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_image_format='WEBP')
    print(f'props: {os.path.getsize(path) / 1e6:.2f} MB')

ONLY = set(ARGS[1].split(',')) if len(ARGS) > 1 else None
if not ONLY or 'props' in ONLY: build_props()
if ONLY and 'props' in ONLY and len(ONLY) == 1: raise SystemExit
build_anims()
build_character('Male')
build_character('Female')

#!/usr/bin/env python3
"""Builds the game's sound effects from Kenney's CC0 audio packs.

    npm run candidates:fetch -- k-sci-fi-sounds k-interface-sounds
    python3 -I scripts/build_audio.py

For every sound id below it decodes the source file with ffmpeg, trims leading and trailing
silence, normalises the level for its category, turns ambience into a seamless loop (the tail is
crossfaded into the head), and writes Ogg Vorbis and AAC copies to public/assets/audio/sfx/.
It also writes src/audio/manifest.json: the source file, pack, author and licence of each sound.
Nothing is synthesised here; music and the synthesised ambience layers are generated in the
browser (src/audio/music.ts, src/audio/ambience.ts).
"""
import json, os, subprocess, sys
import numpy as np

ROOT = os.getcwd()
CAND = os.path.join(ROOT, 'dev-assets', 'candidates')
OUT = os.path.join(ROOT, 'public', 'assets', 'audio', 'sfx')
MANIFEST = os.path.join(ROOT, 'src', 'audio', 'manifest.json')
SR = 44100

PACKS = {
    'ui': ('k-interface-sounds', 'Interface Sounds', 'https://opengameart.org/content/interface-sounds'),
    'sf': ('k-sci-fi-sounds', 'Sci-fi Sounds', 'https://opengameart.org/content/sci-fi-sounds'),
}

# id: (pack, [source files], target peak dBFS, options)
SOUNDS = {
    'ui.hover':       ('ui', ['tick_002'], -24, {}),
    'ui.click':       ('ui', ['click_002', 'click_003'], -16, {}),
    'ui.select':      ('ui', ['select_002'], -15, {}),
    'ui.open':        ('ui', ['maximize_008'], -17, {}),
    'ui.close':       ('ui', ['minimize_008'], -18, {}),
    'ui.toggle':      ('ui', ['toggle_002'], -15, {}),
    'ui.confirm':     ('ui', ['confirmation_001'], -13, {}),
    'ui.error':       ('ui', ['error_004'], -14, {}),
    'notify.info':    ('ui', ['bong_001'], -14, {}),
    'notify.good':    ('ui', ['confirmation_002'], -12, {}),
    'notify.warn':    ('ui', ['question_003'], -12, {}),
    'notify.danger':  ('ui', ['error_005'], -11, {}),
    'res.trade':      ('ui', ['drop_002'], -13, {}),
    'diplomacy':      ('ui', ['pluck_002'], -12, {}),
    'treaty':         ('ui', ['confirmation_004'], -11, {}),
    'character':      ('ui', ['select_005'], -14, {}),
    'build.start':    ('sf', ['doorClose_001'], -13, {}),
    'build.done':     ('sf', ['forceField_001'], -14, {}),
    'research.done':  ('sf', ['forceField_003'], -12, {}),
    'recruit':        ('sf', ['doorOpen_001'], -13, {}),
    'fleet.order':    ('sf', ['thrusterFire_002'], -15, {'cut': 1.1}),
    'combat.laser':   ('sf', ['laserLarge_000', 'laserLarge_002'], -16, {}),
    'combat.explosion': ('sf', ['explosionCrunch_001', 'explosionCrunch_003'], -12, {}),
    'combat.distant': ('sf', ['lowFrequency_explosion_001'], -12, {}),
    'combat.impact':  ('sf', ['impactMetal_002'], -15, {}),
    'mega.stage':     ('sf', ['lowFrequency_explosion_000'], -10, {}),
    'amb.fleet':      ('sf', ['spaceEngineLow_001'], -18, {'loop': True}),
    'amb.industry':   ('sf', ['spaceEngineLarge_002'], -20, {'loop': True}),
    'amb.machines':   ('sf', ['computerNoise_001'], -26, {'loop': True}),
    'amb.metal':      ('sf', ['impactMetal_000', 'impactMetal_003'], -22, {}),
}

def find(pack_dir, name):
    for dp, _, files in os.walk(os.path.join(CAND, pack_dir)):
        if name + '.ogg' in files:
            return os.path.join(dp, name + '.ogg')
    sys.exit(f'missing {name}.ogg in {pack_dir}: run npm run candidates:fetch -- k-sci-fi-sounds k-interface-sounds')

def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

def trim(x, thresh=10 ** (-60 / 20)):
    idx = np.where(np.abs(x) > thresh)[0]
    if not len(idx): return x
    a, b = max(0, idx[0] - 64), min(len(x), idx[-1] + 256)
    return x[a:b]

def fade(x, fin=0.002, fout=0.01):
    n_in, n_out = min(int(fin * SR), len(x) // 4), min(int(fout * SR), len(x) // 2)
    if n_in: x[:n_in] *= np.linspace(0, 1, n_in)
    if n_out: x[-n_out:] *= np.linspace(1, 0, n_out)
    return x

def seamless(x, xf=0.6):
    """Crossfade the last `xf` seconds into the first, giving a loop with no seam."""
    n = int(xf * SR)
    head, body, tail = x[:n], x[n:-n] if len(x) > 3 * n else x[n:], x[-n:]
    t = np.linspace(0, 1, n)
    blend = tail * np.cos(t * np.pi / 2) + head * np.sin(t * np.pi / 2)
    return np.concatenate([body, blend]).astype(np.float32)

def normalise(x, peak_db):
    p = np.max(np.abs(x)) or 1.0
    return (x * (10 ** (peak_db / 20) / p)).astype(np.float32)

def encode(x, base):
    pcm = x.astype(np.float32).tobytes()
    common = ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-']
    subprocess.run(common + ['-c:a', 'libvorbis', '-q:a', '4', base + '.ogg'], input=pcm, check=True)
    subprocess.run(common + ['-c:a', 'aac', '-b:a', '96k', base + '.m4a'], input=pcm, check=True)

def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    manifest = {'_comment': 'Generated by scripts/build_audio.py. Every sound effect, its source file and licence.', 'sounds': {}}
    total = 0
    for sid, (pk, names, peak, opt) in SOUNDS.items():
        pack_dir, pack_name, page = PACKS[pk]
        files = []
        for i, name in enumerate(names):
            x = decode(find(pack_dir, name))
            if opt.get('loop'):
                x = seamless(x)
            else:
                x = trim(x)
                if opt.get('cut'): x = x[: int(opt['cut'] * SR)]
                x = fade(x, fout=0.25 if opt.get('cut') else 0.01)
            x = normalise(x, peak)
            base = f'{sid}{"" if len(names) == 1 else "." + str(i)}'
            encode(x, os.path.join(OUT, base))
            total += os.path.getsize(os.path.join(OUT, base + '.ogg')) + os.path.getsize(os.path.join(OUT, base + '.m4a'))
            files.append({'file': base, 'source': f'{name}.ogg', 'seconds': round(len(x) / SR, 3)})
        manifest['sounds'][sid] = {'files': files, 'loop': bool(opt.get('loop')), 'pack': pack_name, 'author': 'Kenney (www.kenney.nl)', 'license': 'CC0 1.0', 'page': page}
    with open(MANIFEST, 'w') as f:
        json.dump(manifest, f, indent=1)
        f.write('\n')
    print(f'{len(SOUNDS)} sounds, {total / 1e6:.2f} MB written to {OUT}')

main()

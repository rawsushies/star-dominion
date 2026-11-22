#!/usr/bin/env python3
"""Records the advisor's lines (src/guidance/voice-lines.json) with Piper, an open-source
speech engine running locally, using the Scottish "Alba" voice (CC BY 4.0, see the licence
manifest). Writes public/assets/audio/voice/<id>.ogg and .m4a. Re-run after editing lines;
unchanged lines are skipped.

    pip install piper-tts && python3 scripts/build_voice.py
"""
import hashlib, json, os, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINES = os.path.join(ROOT, 'src', 'guidance', 'voice-lines.json')
OUT = os.path.join(ROOT, 'public', 'assets', 'audio', 'voice')
CACHE = os.environ.get('PIPER_CACHE', os.path.join(os.path.expanduser('~'), '.cache', 'piper'))
VOICE = 'en_GB-alba-medium'
# how names are said (the screen keeps the written spelling)
SAY: dict = {}
BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/'

def model():
    os.makedirs(CACHE, exist_ok=True)
    for f in (VOICE + '.onnx', VOICE + '.onnx.json'):
        p = os.path.join(CACHE, f)
        if not os.path.exists(p):
            print('downloading', f); urllib.request.urlretrieve(BASE + f, p)
    return os.path.join(CACHE, VOICE + '.onnx')

def main():
    lines = {k: v for k, v in json.load(open(LINES)).items() if not k.startswith('_')}
    os.makedirs(OUT, exist_ok=True)
    stamp_path = os.path.join(OUT, 'stamps.json')
    stamps = json.load(open(stamp_path)) if os.path.exists(stamp_path) else {}
    m = model()
    for k, text in lines.items():
        spoken = text
        for a, b in SAY.items(): spoken = spoken.replace(a, b)
        h = hashlib.sha1((VOICE + spoken).encode()).hexdigest()[:12]
        if stamps.get(k) == h and os.path.exists(os.path.join(OUT, k + '.ogg')): continue
        wav = os.path.join(CACHE, k + '.wav')
        subprocess.run([sys.executable, '-m', 'piper', '-m', m, '-f', wav, '--length-scale', '1.08', '--sentence-silence', '0.25'], input=spoken.encode(), check=True, capture_output=True)
        # a touch of room and warmth: gentle low-pass, light compression, normalised loudness
        filt = 'highpass=f=70,lowpass=f=9000,acompressor=threshold=-18dB:ratio=2.5:attack=5:release=120,loudnorm=I=-17:TP=-1.5'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-af', filt, '-ac', '1', '-c:a', 'libvorbis', '-q:a', '3', os.path.join(OUT, k + '.ogg')], check=True)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-af', filt, '-ac', '1', '-c:a', 'aac', '-b:a', '48k', os.path.join(OUT, k + '.m4a')], check=True)
        os.remove(wav)
        stamps[k] = h
        print('recorded', k)
    for f in os.listdir(OUT):
        k = f.rsplit('.', 1)[0]
        if f != 'stamps.json' and k not in lines: os.remove(os.path.join(OUT, f))
    json.dump({k: stamps[k] for k in lines if k in stamps}, open(stamp_path, 'w'), indent=1, sort_keys=True)

if __name__ == '__main__':
    main()

# Tone-maps an equirectangular Radiance .hdr to an sRGB JPEG (ACES filmic curve) with ffmpeg + numpy.
#   python3 scripts/lib/tonemap_hdr.py in.hdr out.jpg [exposure]
import subprocess, sys, json
import numpy as np
src, dst = sys.argv[1], sys.argv[2]
exposure = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', src]))
w, h = probe['streams'][0]['width'], probe['streams'][0]['height']
raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', '-'])
g, b, r = np.frombuffer(raw, dtype=np.float32).reshape(3, h, w)
x = np.stack([r, g, b], axis=-1) * exposure
x = np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)  # ACES (Narkowicz)
x = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
rgb = (np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-i', '-', '-q:v', '3', dst], input=rgb.tobytes(), check=True)

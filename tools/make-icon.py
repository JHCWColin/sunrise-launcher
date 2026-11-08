"""Generate the Sunrise Launcher app icon (PNG + multi-size ICO)."""
import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")
os.makedirs(OUT_DIR, exist_ok=True)

yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
nx = xx / (SIZE - 1)
ny = yy / (SIZE - 1)

# Base vertical gradient: deep night blue -> near black
top = np.array([13, 22, 40], dtype=np.float32)
mid = np.array([7, 13, 24], dtype=np.float32)
bot = np.array([3, 6, 12], dtype=np.float32)
t = np.clip(ny * 1.08, 0, 1)
base = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
for c in range(3):
    base[..., c] = np.where(t < 0.62, top[c] + (mid[c] - top[c]) * (t / 0.62), mid[c] + (bot[c] - mid[c]) * ((t - 0.62) / 0.38))

# Subtle blue radial light in upper right
d_blue = np.sqrt(((nx - 0.78) * 1.15) ** 2 + ((ny - 0.10) * 1.0) ** 2)
blue = np.clip(1 - d_blue / 0.58, 0, 1) ** 2 * 0.20
base[..., 2] += blue * 120
base[..., 1] += blue * 48

# Warm ambient glow around the sun
sun_cx, sun_cy = 0.50, 0.615
d_sun = np.sqrt((nx - sun_cx) ** 2 + (ny - sun_cy) ** 2)
warm = np.clip(1 - d_sun / 0.55, 0, 1) ** 2
base[..., 0] += warm * 78
base[..., 1] += warm * 38
base[..., 2] += warm * 8

base = np.clip(base, 0, 255).astype(np.uint8)
img = Image.fromarray(base, "RGB").convert("RGBA")

# Round-corner mask
mask = Image.new("L", (SIZE, SIZE), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=226, fill=255)
img.putalpha(mask)

# --- Sun disc ---
sun_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sun_pixels = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
cx = int(SIZE * sun_cx)
cy = int(SIZE * sun_cy)
radius = 246
for y in range(max(0, cy - radius), min(SIZE, cy + radius + 1)):
    for x in range(max(0, cx - radius), min(SIZE, cx + radius + 1)):
        dx = (x - cx) / radius
        dy = (y - cy) / radius
        d = math.sqrt(dx * dx + dy * dy)
        if d > 1:
            continue
        # vertical warm gradient
        k = max(0.0, min(1.0, (y - (cy - radius)) / (2 * radius)))
        if k < 0.35:
            col = (255, 253, 242)
        elif k < 0.62:
            f = (k - 0.35) / 0.27
            col = (255, 253 - 30 * f, 242 - 110 * f)
        else:
            f = (k - 0.62) / 0.38
            col = (255, 223 - 70 * f, 132 - 78 * f)
        edge = min(1.0, (1 - d) * 14)
        alpha = int(255 * edge)
        sun_pixels[y, x] = (col[0], col[1], col[2], alpha)
sun_layer = Image.fromarray(sun_pixels, "RGBA")

# Glow behind sun
glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
for r, a in [(420, 26), (340, 40), (270, 58), (215, 80)]:
    gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 164, 70, a))
glow = glow.filter(ImageFilter.GaussianBlur(56))
img = Image.alpha_composite(img, glow)

# Clip the sun at the horizon (soft 26px fade, zero below)
horizon = int(SIZE * 0.705)
sun_arr = np.array(sun_layer).astype(np.float32)
fade_zone = 26
for y in range(horizon - fade_zone, horizon):
    factor = (y - (horizon - fade_zone)) / fade_zone
    sun_arr[y, :, 3] *= factor
sun_arr[horizon:, :, 3] = 0
sun_layer = Image.fromarray(np.clip(sun_arr, 0, 255).astype(np.uint8), "RGBA")
img = Image.alpha_composite(img, sun_layer)

# --- Horizon line and ground ---
# Opaque ground from the horizon down, so the clipped sun never ghosts through.
ground = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gdr = ImageDraw.Draw(ground)
for y in range(horizon, SIZE):
    k = (y - horizon) / (SIZE - horizon)
    col = (
        int(10 - 8 * k),
        int(17 - 12 * k),
        int(29 - 19 * k),
        255,
    )
    gdr.line([(0, y), (SIZE, y)], fill=col)
# Soft horizontal reflection shimmer, drawn on its own layer so it blends.
reflect = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
rfd = ImageDraw.Draw(reflect)
for i in range(10):
    y = horizon + 14 + i * 9
    half = 300 - i * 24
    alpha = max(0, 46 - i * 4)
    if half > 10:
        rfd.line([(cx - half, y), (cx + half, y)], fill=(255, 148, 58, alpha), width=5)
reflect = reflect.filter(ImageFilter.GaussianBlur(6))
ground = Image.alpha_composite(ground, reflect)
img = Image.alpha_composite(img, ground)

# horizon glow line
line = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ld = ImageDraw.Draw(line)
ld.line([(96, horizon), (SIZE - 96, horizon)], fill=(255, 196, 116, 215), width=3)
ld.line([(160, horizon + 2), (SIZE - 160, horizon + 2)], fill=(255, 140, 54, 80), width=10)
line = line.filter(ImageFilter.GaussianBlur(3))
img = Image.alpha_composite(img, line)

# --- Rays ---
rays = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
rd = ImageDraw.Draw(rays)
for i in range(18):
    angle = math.radians(i * 20 + 8)
    r1, r2 = 250, 520
    x1, y1 = cx + math.cos(angle) * r1, cy + math.sin(angle) * r1
    x2, y2 = cx + math.cos(angle) * r2, cy + math.sin(angle) * r2
    rd.line([(x1, y1), (x2, y2)], fill=(255, 190, 110, 26), width=3)
rays = rays.filter(ImageFilter.GaussianBlur(9))
rays_mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(rays_mask).rectangle([0, 0, SIZE, horizon - 4], fill=255)
rays.putalpha(Image.composite(rays.getchannel("A"), Image.new("L", (SIZE, SIZE), 0), rays_mask))
img = Image.alpha_composite(img, rays)

# --- Stars ---
stars = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(stars)
rng = np.random.default_rng(20261108)
for _ in range(54):
    x = int(rng.uniform(70, SIZE - 70))
    y = int(rng.uniform(60, horizon - 150))
    if math.hypot(x - cx, y - cy) < 330:
        continue
    r = rng.uniform(0.8, 2.4)
    a = int(rng.uniform(30, 110))
    sd.ellipse([x - r, y - r, x + r, y + r], fill=(220, 235, 255, a))
img = Image.alpha_composite(img, stars)

# --- Glass rim ---
rim = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
rd2 = ImageDraw.Draw(rim)
rd2.rounded_rectangle([10, 10, SIZE - 11, SIZE - 11], radius=218, outline=(255, 255, 255, 52), width=4)
rd2.rounded_rectangle([22, 22, SIZE - 23, SIZE - 23], radius=208, outline=(255, 210, 150, 20), width=2)
rim = rim.filter(ImageFilter.GaussianBlur(1.2))
img = Image.alpha_composite(img, rim)

# final rounded mask to clean up
img.putalpha(mask)

png_path = os.path.join(OUT_DIR, "icon.png")
img.save(png_path, "PNG")
print("saved", png_path)

ico_sizes = [16, 24, 32, 48, 64, 128, 256]
ico_path = os.path.join(OUT_DIR, "icon.ico")
img.save(ico_path, format="ICO", sizes=[(s, s) for s in ico_sizes])
print("saved", ico_path)

# A 512px copy for in-app / README usage
img.resize((512, 512), Image.LANCZOS).save(
    os.path.join(OUT_DIR, "icon-512.png"), "PNG"
)
print("done")

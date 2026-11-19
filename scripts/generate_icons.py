"""
Generate every app-icon / store asset from one vector definition.

    python scripts/generate_icons.py

Outputs (assets/images/):
    icon.png                1024x1024  full-bleed app icon (iOS / legacy Android)
    adaptive-icon.png       1024x1024  Android adaptive foreground (transparent, safe-zone)
    splash-icon.png         1024x1024  splash mark (transparent, white)
    notification-icon.png     96x96    Android status-bar icon (white silhouette)
    favicon.png               48x48    web favicon
    icon-512.png             512x512   Google Play store icon
    feature-graphic.png     1024x500   Google Play feature graphic

The SVG path data for the in-app <AppLogo/> component is printed to stdout
so the in-app logo is geometrically identical to the launcher icon.
"""
from __future__ import annotations

import math
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..", "assets", "images")
SS = 4  # supersampling factor

GREEN_TOP = (16, 185, 129)    # #10b981
GREEN_BOT = (4, 120, 87)      # #047857
CHECK = (5, 150, 105)         # #059669
WHITE = (255, 255, 255)


# ── Geometry (1024 unit canvas) ────────────────────────────────────────────────

def rounded_poly(pts, r, steps=12):
    """Round every corner of a convex polygon with radius r."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        v1 = (p0[0] - p1[0], p0[1] - p1[1])
        v2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1, l2 = math.hypot(*v1), math.hypot(*v2)
        u1 = (v1[0] / l1, v1[1] / l1)
        u2 = (v2[0] / l2, v2[1] / l2)
        ang = math.acos(max(-1, min(1, u1[0] * u2[0] + u1[1] * u2[1])))
        d = r / math.tan(ang / 2)
        a = (p1[0] + u1[0] * d, p1[1] + u1[1] * d)
        b = (p1[0] + u2[0] * d, p1[1] + u2[1] * d)
        # quadratic-ish arc approximated through the corner
        for s in range(steps + 1):
            t = s / steps
            x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * b[0]
            y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * b[1]
            out.append((x, y))
    return out


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# Mark is designed around the 1024 canvas, centred on (512, 520).
LID = rounded_poly(rect(282, 318, 742, 384), 26)
RING_L = rounded_poly(rect(388, 236, 436, 346), 24)
RING_R = rounded_poly(rect(588, 236, 636, 346), 24)
BODY = rounded_poly([(316, 414), (708, 414), (664, 812), (360, 812)], 38)
CHECK_PTS = [(410, 610), (486, 686), (624, 532)]
CHECK_W = 58


def transform(poly, scale, dx, dy):
    return [(x * scale + dx, y * scale + dy) for x, y in poly]


def draw_mark(img: Image.Image, scale: float, dx: float, dy: float,
              fg=WHITE, check=CHECK, check_cutout=False):
    d = ImageDraw.Draw(img)
    for poly in (LID, RING_L, RING_R, BODY):
        d.polygon(transform(poly, scale, dx, dy), fill=fg)
    pts = transform(CHECK_PTS, scale, dx, dy)
    w = CHECK_W * scale
    color = (0, 0, 0, 0) if check_cutout else check
    d.line(pts, fill=color, width=int(w), joint="curve")
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=color)


def gradient(size, top=GREEN_TOP, bot=GREEN_BOT):
    w, h = size
    img = Image.new("RGBA", size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        # diagonal-ish: blend by y with slight x tilt via two passes is overkill
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c + (255,))
    return img


def glow(img: Image.Image, cx, cy, r, alpha=40):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    steps = 40
    for i in range(steps, 0, -1):
        rr = r * i / steps
        a = int(alpha * (1 - i / steps) ** 1.5)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(255, 255, 255, a))
    img.alpha_composite(layer)


def save(img: Image.Image, name: str, size):
    out = img.resize(size, Image.LANCZOS)
    path = os.path.join(ROOT, name)
    out.save(path, optimize=True)
    print("wrote", name, size)


def full_icon(px=1024):
    big = px * SS
    img = gradient((big, big))
    glow(img, big * 0.5, big * 0.42, big * 0.55, alpha=55)
    s = big / 1024
    draw_mark(img, s * 0.92, big * 0.04, big * 0.02)
    return img


def main():
    os.makedirs(ROOT, exist_ok=True)

    icon = full_icon(1024)
    save(icon.convert("RGB"), "icon.png", (1024, 1024))
    save(icon.convert("RGB"), "icon-512.png", (512, 512))
    save(icon, "favicon.png", (48, 48))

    # Adaptive foreground: content must fit the inner 66% safe zone.
    big = 1024 * SS
    fg = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    k = 0.62
    draw_mark(fg, SS * k, big * (1 - k) / 2, big * (1 - k) / 2 - big * 0.01)
    save(fg, "adaptive-icon.png", (1024, 1024))

    # Splash mark (white on transparent, sits on green splash background).
    sp = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw_mark(sp, SS * 0.9, big * 0.05, big * 0.03)
    save(sp, "splash-icon.png", (1024, 1024))

    # Notification icon: pure white silhouette, check cut out.
    ni = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw_mark(ni, SS * 1.0, 0, -big * 0.01, check_cutout=True)
    save(ni, "notification-icon.png", (96, 96))

    # Feature graphic 1024x500.
    W, H = 1024 * SS, 500 * SS
    fgx = gradient((W, H))
    glow(fgx, W * 0.2, H * 0.5, H * 0.75, alpha=60)
    draw_mark(fgx, SS * 0.45, W * 0.2 - 512 * SS * 0.45, H * 0.5 - 524 * SS * 0.45)
    d = ImageDraw.Draw(fgx)
    fonts = "C:/Windows/Fonts"
    bold = ImageFont.truetype(os.path.join(fonts, "segoeuib.ttf"), 74 * SS)
    reg = ImageFont.truetype(os.path.join(fonts, "segoeui.ttf"), 34 * SS)
    x = W * 0.40
    d.text((x, H * 0.27), "Neu-Ulm", font=bold, fill=WHITE)
    d.text((x, H * 0.27 + 86 * SS), "Abfallkalender", font=bold, fill=WHITE)
    d.text((x, H * 0.27 + 196 * SS), "Abholtermine · Erinnerungen · Karte",
           font=reg, fill=(209, 250, 229))
    save(fgx.convert("RGB"), "feature-graphic.png", (1024, 500))

    # SVG paths for the in-app component.
    def path(poly):
        return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in poly) + " Z"
    print("\n// SVG paths (1024 viewBox)")
    for name, poly in (("LID", LID), ("RING_L", RING_L), ("RING_R", RING_R), ("BODY", BODY)):
        print(f'const {name} = "{path(poly)}";')
    print("const CHECK = \"M" + " L".join(f"{x} {y}" for x, y in CHECK_PTS) + "\";")


if __name__ == "__main__":
    main()

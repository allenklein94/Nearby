"""
Regenerates the raster Nearby brand assets (app icon, notification icon,
splash mark, Android adaptive icon foreground) from the real "N Connection"
mark artwork the user supplied (assets/branding/nearby-brand-final.png),
not a redrawn approximation of it.

The source file is a full brand-identity sheet (logo variations, palette,
backgrounds, wordmark lockups) rendered on a near-black canvas. This script
extracts the single large, cleanest rendering of the mark (top-left of the
sheet), keys out its background via a luminance threshold (the source has
almost no anti-aliasing noise to fight — background ~(1,3,15), glyph always
>240 on at least one channel), crops tight to the glyph's real bounding box,
and reuses that one real RGBA glyph asset to build every derived file below.
Nothing about the glyph's shape is invented here — only background color,
padding, and per-target fill (white vs. the glyph's own gradient) vary.

Run: python3 scripts/generate-brand-assets.py
"""
from PIL import Image
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "assets", "branding", "nearby-brand-final.png")

# Region of the source sheet containing the large, clean, background-square
# -free rendering of the mark (top-left of the sheet). Generous padding on
# purpose; get_glyph_alpha() below crops tight to the real content bbox.
GLYPH_SOURCE_BOX = (30, 70, 380, 355)

# Background of the source sheet (sampled directly, not guessed) — used both
# as the alpha-key threshold and as the app icon's own background color,
# since the sheet's own "APP ICON PREVIEW" mockup shows the mark on this
# exact dark background, not on a coral/peach square.
SHEET_BG = (1, 3, 15)
ICON_BG = (4, 7, 22)  # a hair lighter than the raw sample, avoids pure-black banding

CREAM_WHITE = (255, 246, 240)

_GLYPH_CACHE = None


def _luminance_alpha(rgb_im):
    """Alpha = how far a pixel is from the sheet's near-black background,
    normalized so the background goes to 0 and the glyph (which is always
    bright on at least one channel) goes to 255. A soft ramp, not a hard
    cut, so anti-aliased glyph edges stay smooth instead of jagged."""
    px = rgb_im.load()
    w, h = rgb_im.size
    alpha = Image.new("L", (w, h))
    apx = alpha.load()
    lo, hi = 22, 70  # soft threshold band, just above the ~15 background peak
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            m = max(r, g, b)
            if m <= lo:
                apx[x, y] = 0
            elif m >= hi:
                apx[x, y] = 255
            else:
                apx[x, y] = round((m - lo) * 255 / (hi - lo))
    return alpha


def get_glyph_rgba():
    """Loads (and caches) the real mark, keyed to RGBA with its own natural
    gradient coloring, cropped tight to content — the single source of truth
    every output below is built from."""
    global _GLYPH_CACHE
    if _GLYPH_CACHE is not None:
        return _GLYPH_CACHE
    sheet = Image.open(SOURCE).convert("RGB")
    region = sheet.crop(GLYPH_SOURCE_BOX)
    alpha = _luminance_alpha(region)
    rgba = region.convert("RGBA")
    rgba.putalpha(alpha)
    bbox = alpha.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    _GLYPH_CACHE = rgba
    return _GLYPH_CACHE


def _paste_glyph_scaled(canvas, glyph, margin_frac):
    """Scales `glyph` (preserving aspect ratio) to fit canvas with the given
    fractional margin on all sides, and pastes it centered."""
    cw, ch = canvas.size
    usable_w = cw * (1 - 2 * margin_frac)
    usable_h = ch * (1 - 2 * margin_frac)
    gw, gh = glyph.size
    scale = min(usable_w / gw, usable_h / gh)
    new_size = (max(1, round(gw * scale)), max(1, round(gh * scale)))
    resized = glyph.resize(new_size, Image.LANCZOS)
    ox = (cw - new_size[0]) // 2
    oy = (ch - new_size[1]) // 2
    canvas.paste(resized, (ox, oy), resized)


def make_app_icon(size=1024, margin_frac=0.16):
    """The real gradient glyph on the sheet's own dark background — matches
    the brand sheet's own "APP ICON PREVIEW" mockup exactly, not a redrawn
    guess. No pre-rounded corners — iOS/Android apply their own mask."""
    glyph = get_glyph_rgba()
    canvas = Image.new("RGBA", (size, size), ICON_BG + (255,))
    _paste_glyph_scaled(canvas, glyph, margin_frac)
    canvas.convert("RGB").save(os.path.join(ROOT, "assets", "icon.png"))
    print("wrote assets/icon.png", canvas.size)


def make_notification_icon(size=256, margin_frac=0.10):
    """White silhouette, alpha-only shape, transparent background — Android
    requires the notification icon to be a flat white shape with no color,
    the OS re-tints it itself. Uses the real glyph's own alpha (true shape),
    filled solid white instead of its gradient."""
    glyph = get_glyph_rgba()
    silhouette = Image.new("RGBA", glyph.size, (255, 255, 255, 0))
    silhouette.putalpha(glyph.split()[3])
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    _paste_glyph_scaled(canvas, silhouette, margin_frac)
    canvas.save(os.path.join(ROOT, "assets", "notification-icon.png"))
    print("wrote assets/notification-icon.png", canvas.size)


def make_splash_mark(size=512, margin_frac=0.05):
    """Transparent PNG of the real gradient glyph alone, for splash.image —
    sits centered on the light cream splash background (app.json's
    splash.backgroundColor)."""
    glyph = get_glyph_rgba()
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    _paste_glyph_scaled(canvas, glyph, margin_frac)
    out_dir = os.path.join(ROOT, "assets", "branding")
    os.makedirs(out_dir, exist_ok=True)
    canvas.save(os.path.join(out_dir, "splash-mark.png"))
    print("wrote assets/branding/splash-mark.png", canvas.size)


def make_adaptive_icon_foreground(size=1024, margin_frac=0.30):
    """Android adaptive icon foreground layer — cream-white glyph (same real
    shape, flat-filled), transparent background, generously padded so it
    survives every launcher mask shape (circle/squircle/rounded-square)
    without clipping. Pairs with android.adaptiveIcon.backgroundColor
    (already #FF5A5F, the sheet's own coral, in app.json)."""
    glyph = get_glyph_rgba()
    solid = Image.new("RGBA", glyph.size, CREAM_WHITE + (255,))
    solid.putalpha(glyph.split()[3])
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    _paste_glyph_scaled(canvas, solid, margin_frac)
    out_dir = os.path.join(ROOT, "assets", "branding")
    os.makedirs(out_dir, exist_ok=True)
    canvas.save(os.path.join(out_dir, "adaptive-icon-foreground.png"))
    print("wrote assets/branding/adaptive-icon-foreground.png", canvas.size)


if __name__ == "__main__":
    make_app_icon()
    make_notification_icon()
    make_splash_mark()
    make_adaptive_icon_foreground()

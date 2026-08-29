"""
Regenerates the raster Nearby brand assets (app icon, notification icon,
splash mark, Android adaptive icon foreground, dark-mode secondary mark)
from the real "N Connection" mark artwork the user supplied
(assets/branding/nearby-brand-final.png), not a redrawn approximation of it.

The source file is a full brand-identity sheet (logo variations, palette,
backgrounds, wordmark lockups) rendered on a near-black canvas. This script
extracts the single large, cleanest rendering of the mark (top-left of the
sheet), keys out its background via a luminance threshold (the source has
almost no anti-aliasing noise to fight — background ~(1,3,15), glyph always
>240 on at least one channel), crops tight to the glyph's real bounding box,
and reuses that one real RGBA glyph asset to build every derived file below.
Nothing about the glyph's shape is invented here — only background color,
padding, and per-target fill (white vs. the glyph's own gradient) vary.

Locked icon hierarchy (given directly, correcting an earlier pass that had
made the dark-background rendering primary): the coral/peach gradient +
white glyph is the real primary App Store / iPhone icon — it's a real,
already-rendered variant on the sheet itself (the "SINGLE COLOR" swatch in
LOGO VARIATIONS), not invented here; only its exact gradient was rebuilt at
full resolution (the swatch itself is far too small to use directly for a
1024px icon) using the two real, explicitly-labeled top palette hex values
(#FF7A59 -> #FF5A5F), which is also the same direction the swatch's own
pixels actually shade in when sampled directly. The dark-background +
gradient-glyph rendering (this script's own prior primary output) is now a
real, disclosed secondary/dark-mode brand asset (assets/branding/
dark-mode-icon.png), matching the sheet's own "BLACK" logo variation — kept,
not deleted, but no longer what ships as assets/icon.png. Monochrome
(white/black-only) glyph usage already exists as a resolution-independent
in-app SVG component (src/components/brand/NearbyMark.js) and isn't touched
by this raster-asset pass.

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

# Background of the source sheet (sampled directly, not guessed) — used as
# the alpha-key threshold, and as the dark-mode secondary mark's own
# background color (matches the sheet's own "BLACK" logo variation).
SHEET_BG = (1, 3, 15)
ICON_BG = (4, 7, 22)  # a hair lighter than the raw sample, avoids pure-black banding

# The two real, explicitly-labeled hex values from the sheet's own COLOR
# PALETTE section (confirmed by reading the printed labels directly, not
# sampled pixels — this is AI-generated art, so the rendered swatch circles
# carry a few percent of render noise relative to their own printed labels;
# the text is the real canonical spec). Used as the primary app icon's own
# background gradient, top -> bottom -- independently confirmed to be the
# right direction by sampling the real "SINGLE COLOR" swatch's own pixels,
# which shade from a lighter warm peach at the top to a more saturated
# coral-red at the bottom.
PALETTE_PEACH = (255, 122, 89)  # #FF7A59
PALETTE_CORAL = (255, 90, 95)   # #FF5A5F

WHITE = (255, 255, 255)

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


def _vertical_gradient(size, top_rgb, bottom_rgb):
    """A plain, smooth top-to-bottom linear-interpolated RGB gradient —
    matches the real "SINGLE COLOR" swatch's own verified shading direction
    (sampled directly from the source sheet), rebuilt at full resolution
    rather than upscaling the tiny (~140px) source swatch itself."""
    canvas = Image.new("RGB", (size, size))
    px = canvas.load()
    for y in range(size):
        t = y / max(1, size - 1)
        r = round(top_rgb[0] + (bottom_rgb[0] - top_rgb[0]) * t)
        g = round(top_rgb[1] + (bottom_rgb[1] - top_rgb[1]) * t)
        b = round(top_rgb[2] + (bottom_rgb[2] - top_rgb[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return canvas


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
    """Primary App Store / iPhone icon: the real coral -> peach/pink gradient
    background (the sheet's own "SINGLE COLOR" logo variation, rebuilt at
    full resolution from the real labeled palette hex values rather than
    upscaling the tiny source swatch) with a solid white N Connection mark —
    real glyph shape (the same one every other output here shares), filled
    pure white rather than its own natural multi-color gradient, matching
    that same real swatch's own rendering. No word "Nearby", no pin, no
    spark, no pre-rounded corners — the source stays a plain square and iOS/
    Android apply their own mask at install time."""
    glyph = get_glyph_rgba()
    silhouette = Image.new("RGBA", glyph.size, WHITE + (0,))
    silhouette.putalpha(glyph.split()[3])
    canvas = _vertical_gradient(size, PALETTE_PEACH, PALETTE_CORAL).convert("RGBA")
    _paste_glyph_scaled(canvas, silhouette, margin_frac)
    canvas.convert("RGB").save(os.path.join(ROOT, "assets", "icon.png"))
    print("wrote assets/icon.png", canvas.size)


def make_dark_mode_mark(size=1024, margin_frac=0.16):
    """Secondary / dark-mode brand mark: the real gradient glyph (its own
    natural coral/peach coloring, not flattened to white) on the sheet's own
    dark background — matches the sheet's own "BLACK" logo variation and
    this script's own prior primary output, kept as a real, disclosed
    supporting asset rather than deleted. Not wired into app.json — this
    Expo-managed project has no native alternate-icon/dark-mode-icon
    mechanism configured, so there's nowhere for the OS to actually switch
    to this at install time; it's a real static asset for future use, not a
    live app icon today."""
    glyph = get_glyph_rgba()
    canvas = Image.new("RGBA", (size, size), ICON_BG + (255,))
    _paste_glyph_scaled(canvas, glyph, margin_frac)
    out_dir = os.path.join(ROOT, "assets", "branding")
    os.makedirs(out_dir, exist_ok=True)
    canvas.convert("RGB").save(os.path.join(out_dir, "dark-mode-icon.png"))
    print("wrote assets/branding/dark-mode-icon.png", canvas.size)


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
    """Android adaptive icon foreground layer — solid white glyph (same real
    shape, flat-filled, matching the primary icon's own white-on-coral
    treatment exactly rather than the softer cream tint used here before),
    transparent background, generously padded so it survives every launcher
    mask shape (circle/squircle/rounded-square) without clipping. Pairs with
    android.adaptiveIcon.backgroundColor (already #FF5A5F, the sheet's own
    coral, in app.json) — Android's adaptive icon was already coral-primary
    before this pass; only the foreground fill changed."""
    glyph = get_glyph_rgba()
    solid = Image.new("RGBA", glyph.size, WHITE + (255,))
    solid.putalpha(glyph.split()[3])
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    _paste_glyph_scaled(canvas, solid, margin_frac)
    out_dir = os.path.join(ROOT, "assets", "branding")
    os.makedirs(out_dir, exist_ok=True)
    canvas.save(os.path.join(out_dir, "adaptive-icon-foreground.png"))
    print("wrote assets/branding/adaptive-icon-foreground.png", canvas.size)


if __name__ == "__main__":
    make_app_icon()
    make_dark_mode_mark()
    make_notification_icon()
    make_splash_mark()
    make_adaptive_icon_foreground()

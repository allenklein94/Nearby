#!/usr/bin/env python3
"""Design-system consolidation D1-D6 + D8 (owner approved all eight, 2026-11-28; DESIGN_SYSTEM_AUDIT_2026-11-27.md).

Rewrites style literals in src/screens + src/components to the shared scale. Dry run by default (prints every change);
--apply writes. Deterministic and idempotent: a second run changes nothing. Rules (each one matches the audit's
recommendation; the guard src/design/designSystemScale.test.js keeps them true afterwards):

 D1 font sizes  : 9/10/11 -> 12 (nothing below 12), 17 -> 16, 19 -> 20, 21/22/23/24 -> 20 in a NAMED text style.
                  Glyph styles (emoji, icons, avatars, initials, big numbers: names below) and inline styles keep 22/24,
                  and every size >= 26 stays (titles 26/34, emoji/number glyphs 28-84).
 D2 primary btn : a full-width block CTA (a style named *button*/*cta* with a primary background, or an outline = the
                  secondary button, pill radius and vertical padding >= 12) spreads PRIMARY_BUTTON (padding 14, minHeight 48, centred); compact row actions
                  (vertical padding < 12: send, approve, inline) keep their size.
 D3 chips       : every *chip* style with pill radius = padding 6 x 12; the dense Discover filter rows keep 4 x 12.
 D4 cards       : a *card* style's radius = lg (20) and padding 18 -> 12; cards inside a sheet/modal lose their shadow.
 D5 radius      : literal radii -> sm 8 / md 14 / lg 20 / full 999, except hairlines (<= 3) and circles/pills
                  (radius = half the style's width or height).
 D6 spacing     : off-scale margin/padding literals -> nearest token (5 -> 4, 8 -> 6, 10/14 -> 12, 16 -> 18,
                  26/28 -> 24, 32 -> 36); 0-4 (hairline offsets) and layout offsets >= 40 stay.
 D8 women-only  : the women-only badge text uses the darker pink token (contrast >= 4.5:1).
"""
import re, sys, glob, os

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'src')
APPLY = '--apply' in sys.argv
GLYPH = re.compile(r'(emoji|icon|glyph|avatar|initial|number|count|stat|value|big|hero|price|amount|score|logo|mark|digit|symbol|flag|spinner)', re.I)
DENSE_CHIP_FILES = {'DiscoverHubScreen.js', 'GatheringsFilterBar.js', 'DiscoverFilterChips.js'}
SHEET_FILE = re.compile(r'(Sheet|Modal|Panel)\.js$')
FONT_MAP = {9: 12, 10: 12, 11: 12, 17: 16, 19: 20}
FONT_NAMED_ONLY = {21: 20, 22: 20, 23: 20, 24: 20}
SPACE_MAP = {5: 4, 8: 6, 10: 12, 14: 12, 16: 18, 26: 24, 28: 24, 32: 36}

changes = []

def style_blocks(src):
    """Yield (name, start, end) for every `name: { ... }` style object without nested braces."""
    for m in re.finditer(r'(\b\w+):\s*\{([^{}]*)\}', src):
        yield m.group(1), m.start(2), m.end(2)

def radius_target(n, body):
    if n <= 3 or n >= 999:
        return n
    dims = [int(x) for x in re.findall(r'\b(?:width|height|minWidth|minHeight):\s*(\d+)\b', body)]
    if any(abs(d / 2 - n) <= 1 for d in dims):
        return n  # a circle or pill drawn at half its size: keep
    if n <= 10:
        return 8
    if n <= 16:
        return 14
    return 20

def rewrite_body(fname, name, body, in_sheet):
    out = body
    low = name.lower()
    # D1
    def font(m):
        n = int(m.group(1))
        t = FONT_MAP.get(n, n)
        if n in FONT_NAMED_ONLY and not GLYPH.search(name):
            t = FONT_NAMED_ONLY[n]
        return m.group(0) if t == n else f'fontSize: {t}'
    out = re.sub(r'fontSize:\s*(\d+)\b(?!\.)', font, out)
    # D5 (+ D4 card radius)
    if 'card' in low and 'cardImage' not in name:
        out = re.sub(r'borderRadius:\s*(?:\d+|radius\.(?:sm|md))\b', 'borderRadius: radius.lg', out)
        out = re.sub(r'(\bpadding):\s*(?:18|spacing\.lg)\b', r'\1: spacing.md', out)
        if in_sheet:
            out = re.sub(r'\s*\.\.\.shadow\.card,?', '', out)
    else:
        out = re.sub(r'borderRadius:\s*(\d+)\b', lambda m: f'borderRadius: {radius_target(int(m.group(1)), body)}', out)
    # D3
    if 'chip' in low and re.search(r'borderRadius:\s*(?:999|radius\.full)', out):
        dense = fname in DENSE_CHIP_FILES
        pv = 'spacing.xs' if dense else 'spacing.sm'
        out = re.sub(r'paddingVertical:\s*[\w.]+', f'paddingVertical: {pv}', out)
        out = re.sub(r'paddingHorizontal:\s*[\w.]+', 'paddingHorizontal: spacing.md', out)
    # D6
    def space(m):
        n = int(m.group(2))
        t = SPACE_MAP.get(n, n)
        return m.group(0) if t == n else f'{m.group(1)}: {t}'
    out = re.sub(r'\b((?:padding|margin)(?:Horizontal|Vertical|Top|Bottom|Left|Right)?):\s*(\d+)\b(?!\.)', space, out)
    # D2
    if (re.search(r'(button|cta)$', low) and 'fab' not in low and 'badge' not in low
            and (re.search(r'backgroundColor:\s*[\w.]*\bprimary\b', out)
                 or re.search(r'borderWidth:\s*[1-2]\b', out))  # secondary = same shape, outline
            and re.search(r'borderRadius:\s*(?:999|radius\.full)', out)):
        pv = re.search(r'paddingVertical:\s*([\w.]+)', body)  # the ORIGINAL padding decides block vs compact
        val = pv and pv.group(1)
        block = val in ('12', '14', '16', '18', 'spacing.md', 'spacing.lg')
        if block and '...PRIMARY_BUTTON' not in out:
            out = re.sub(r'\s*paddingVertical:\s*[\w.]+,?', '', out, count=1)
            out = re.sub(r'\s*borderRadius:\s*(?:999|radius\.full),?', '', out, count=1)
            out = re.sub(r'\s*minHeight:\s*\d+,?', '', out, count=1)
            indent = re.match(r'\s*', out).group(0) or ' '
            out = indent + '...PRIMARY_BUTTON,' + out
            return out, True
    return out, False

def ensure_import(src, rel):
    if 'PRIMARY_BUTTON' in src.split('StyleSheet.create')[0] and re.search(r'import\s*\{[^}]*PRIMARY_BUTTON', src):
        return src
    m = re.search(r"import\s*\{([^}]*)\}\s*from\s*'" + re.escape(rel) + "';", src)
    if m:
        names = m.group(1).strip().rstrip(',')
        return src[:m.start()] + "import { " + names + ", PRIMARY_BUTTON } from '" + rel + "';" + src[m.end():]
    last = list(re.finditer(r"^import [^;]+;\s*$", src, re.M))[-1]
    return src[:last.end()] + "\nimport { PRIMARY_BUTTON } from '" + rel + "';" + src[last.end():]

def main():
    files = sorted(glob.glob(os.path.join(ROOT, 'screens', '*.js')) + glob.glob(os.path.join(ROOT, 'components', '*.js')))
    total = 0
    for path in files:
        if path.endswith('.test.js'):
            continue
        fname = os.path.basename(path)
        src = open(path).read()
        new, pieces, pos, needs = [], [], 0, False
        for name, s, e in style_blocks(src):
            body = src[s:e]
            nb, used = rewrite_body(fname, name, body, bool(SHEET_FILE.search(fname)))
            needs = needs or used
            if nb != body:
                pieces.append(src[pos:s]); pieces.append(nb); pos = e
                changes.append((fname, name, body.strip().replace('\n', ' ')[:110], nb.strip().replace('\n', ' ')[:110]))
        pieces.append(src[pos:])
        out = ''.join(pieces)
        if needs:
            out = ensure_import(out, '../constants/buttonStates')
        if fname == 'WomenOnlyBadge.js' or 'womenOnly' in out:
            out = re.sub(r"(color:\s*)'#ec4899'", r"\1colors.womenOnlyText", out)
        if out != src:
            total += 1
            if APPLY:
                open(path, 'w').write(out)
    for c in changes:
        print(f'{c[0]} {c[1]}\n   - {c[2]}\n   + {c[3]}')
    print(f'\n{len(changes)} style objects in {total} files' + (' WRITTEN' if APPLY else ' (dry run)'))

main()

#!/usr/bin/env python3
"""Bundle the gallery screenshots into one folder + ZIP you can open anywhere (owner 2026-11-28).

  python make_gallery.py <run dir with shots-preD, shots-main, shots-current, SOURCES.txt> <out dir>

Output: <out dir>/Nearby-design-review-<date>/ with png/<version>/<NN-name>-<light|dark>.png, index.html (one row per screen,
three columns pre-design | main | current, light then dark; click any image for full size) and README.txt; plus the ZIP.
Images are fixture renders (react-native-web, invented "(preview)" data), not phone screenshots.
"""
import html, json, os, shutil, sys, time, zipfile

RUN, OUT = sys.argv[1], sys.argv[2]
VERSIONS = [('preD', 'Before design work'), ('main', 'main (build 87 + merged work)'), ('current', 'This branch (D1-D8 + fixes)')]
stamp = time.strftime('%Y-%m-%d')
root = os.path.join(OUT, f'Nearby-design-review-{stamp}')
shutil.rmtree(root, ignore_errors=True)
os.makedirs(root)
sources = open(os.path.join(RUN, 'SOURCES.txt')).read().strip()
names = set()
reports = {}
for v, _ in VERSIONS:
    src = os.path.join(RUN, f'shots-{v}')
    dst = os.path.join(root, 'png', v)
    os.makedirs(dst)
    for f in sorted(os.listdir(src)):
        if f.endswith('.png'):
            shutil.copy2(os.path.join(src, f), dst)
            names.add(f.rsplit('-', 1)[0])
    rp = os.path.join(src, 'report.json')
    reports[v] = json.load(open(rp)) if os.path.exists(rp) else {}

def cell(v, n, scheme):
    rel = f'png/{v}/{n}-{scheme}.png'
    if not os.path.exists(os.path.join(root, rel)):
        return '<td class="na">not captured</td>'
    r = reports[v].get(f'{n}-{scheme}', {})
    flag = ''
    if r.get('preview_error') or r.get('errors') or r.get('note'):
        flag = f'<div class="flag">render note: {html.escape(r.get("note") or (r.get("errors") or ["preview error"])[0])}</div>'
    return f'<td><a href="{rel}" target="_blank"><img loading="lazy" src="{rel}" alt="{html.escape(n)} {scheme} {v}"></a>{flag}</td>'

rows = []
for n in sorted(names):
    title = n.split('-', 1)[1].replace('-', ' ')
    for scheme in ('light', 'dark'):
        rows.append(f'<tr><th>{html.escape(title)}<br><span>{scheme}</span></th>' + ''.join(cell(v, n, scheme) for v, _ in VERSIONS) + '</tr>')
head = ''.join(f'<th>{html.escape(label)}<br><span>{v}</span></th>' for v, label in VERSIONS)
page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nearby design review {stamp}</title><style>
body{{font:14px/1.4 -apple-system,system-ui,sans-serif;margin:24px;background:#f6f6f4;color:#222}}
h1{{font-size:22px;margin:0 0 4px}} p{{max-width:70em}}
table{{border-collapse:collapse}} th,td{{padding:8px;vertical-align:top;border-bottom:1px solid #ddd}}
thead th{{position:sticky;top:0;background:#f6f6f4;text-align:left}} th span{{color:#777;font-weight:normal;font-size:12px}}
tbody th{{text-align:left;width:150px}} img{{width:240px;border:1px solid #ccc;border-radius:8px;background:#fff}}
.na{{color:#999;width:240px}} .flag{{color:#a40;font-size:12px;max-width:240px}}
</style></head><body><h1>Nearby design review ({stamp})</h1>
<p>Three versions of the same screens, rendered from the real app code with invented fixture data (react-native-web,
iPhone 390 x 844 @2x). Not phone screenshots: fonts, shadows, safe areas, native headers and sheets differ on iOS.
Click any image for full size. Empty / loading / error rows are produced by answering every data call with nothing,
never answering, or failing. "not captured" = that screen or variant does not exist in that version.</p>
<p><b>Sources:</b> {html.escape(sources)}</p>
<table><thead><tr><th>Screen</th>{head}</tr></thead><tbody>{''.join(rows)}</tbody></table></body></html>'''
open(os.path.join(root, 'index.html'), 'w').write(page)
open(os.path.join(root, 'README.txt'), 'w').write(
    f'Open index.html in any browser (it reads the png folder next to it).\nVersions: {sources}\n'
    'Fixture renders, not phone screenshots. One PNG per screen, version and light/dark mode in png/<version>/.\n')
zp = root + '.zip'
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, fs in os.walk(root):
        for f in fs:
            full = os.path.join(d, f)
            z.write(full, os.path.relpath(full, OUT))
print(zp, sum(1 for _ in zipfile.ZipFile(zp).namelist()), 'files')

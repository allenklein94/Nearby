# Run from the repo root (Docker; every request to Supabase is intercepted, nothing is read from or written to it):
#   mkdir -p /tmp/logocheck && docker run --rm -v "$PWD/docs":/site:ro -v "$PWD/scripts/web-check":/work:ro -v /tmp/logocheck:/out \
#     mcr.microsoft.com/playwright/python:v1.47.0-jammy bash -c "pip install -q playwright==1.47.0; python /work/public-pages-logo-headless.py"
# Owner 2026-10-11: on the invite, occasion-invite and shared-night pages the logo reads "Nearby" as one word (icon spacing kept),
# with no horizontal overflow or JavaScript errors, at phone and desktop widths. Screenshots and results.json land in /tmp/logocheck.
import json, subprocess, sys, time
from playwright.sync_api import sync_playwright

srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '--directory', '/site'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8766/'
results = []
def check(name, ok, detail=''):
    results.append({'check': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

LOGO_JS = """() => { const a = document.querySelector('a.brand'); const s = a.querySelector(':scope > span'); const svg = a.querySelector(':scope > svg');
  const r = document.createRange(); r.selectNodeContents(s.previousSibling); const near = r.getBoundingClientRect(), by = s.getBoundingClientRect(), ic = svg.getBoundingClientRect();
  return { word: a.textContent.replace(/\\s+/g, ''), inWord: by.left - near.right, iconGap: near.left - ic.right, left: ic.left, right: by.right,
           vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }; }"""

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for name in ['invite', 'occasion-invite', 'shared-night']:
        for w in [320, 375, 414, 768, 1280]:
            ctx = browser.new_context(viewport={'width': w, 'height': 800})
            page = ctx.new_page()
            errs = []
            page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.route('**/*supabase.co/**', lambda r: r.fulfill(status=200, content_type='application/json', body='[]'))
            page.goto(BASE + name + '.html', wait_until='networkidle')
            l = page.evaluate(LOGO_JS)
            p = f'[{name} {w}px] '
            check(p + 'logo reads "Nearby" with no gap inside the word', l['word'] == 'Nearby' and abs(l['inWord']) < 1, f"{l['word']}, gap {l['inWord']:.1f}px")
            check(p + 'icon keeps its 8 px spacing', abs(l['iconGap'] - 8) < 1, f"{l['iconGap']:.1f}px")
            check(p + 'logo fully on screen', l['left'] >= 0 and l['right'] <= l['vw'])
            check(p + 'no horizontal page scroll', l['sw'] <= l['vw'], f"scrollWidth {l['sw']} / clientWidth {l['vw']}")
            check(p + 'no console or JavaScript errors', not errs, ' | '.join(errs[:3]))
            page.screenshot(path=f'/out/{name}-{w}.png')
            ctx.close()
    browser.close()
srv.terminate()
json.dump(results, open('/out/results.json', 'w'), indent=1)
print(f"\n{sum(r['ok'] for r in results)}/{len(results)} passed")

# Run from the repo root (Docker; nothing is sent to Supabase -- every request to it is intercepted):
#   mkdir -p /tmp/bizcheck && docker run --rm -v "$PWD/docs":/site:ro -v "$PWD/scripts/web-check":/work:ro -v /tmp/bizcheck:/out \
#     mcr.microsoft.com/playwright/python:v1.47.0-jammy bash -c "pip install -q playwright==1.47.0; python /work/business-page-headless.py"
#   Screenshots and results.json land in /tmp/bizcheck.
# Headless check of docs/business.html (owner, 2026-10-11). Every request to Supabase is intercepted: nothing reaches the live
# application function or the funnel table. Prints one line per check and a JSON summary.
import json, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--directory', '/site'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8765/'
results = []
def check(name, ok, detail=''):
    results.append({'check': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

HEADER_JS = """() => {
  const brand = document.querySelector('header.top .brand').getBoundingClientRect();
  const links = [...document.querySelectorAll('nav.top a')].map(a => {
    const r = a.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(a).lineHeight) || 21;
    return { text: a.textContent, lines: a.getClientRects().length, h: r.height, lh, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
  return { brand: { top: brand.top, bottom: brand.bottom, left: brand.left, right: brand.right }, links, vw: document.documentElement.clientWidth };
}"""

def header_layout(browser, width, height=800):
    # owner 2026-10-11: logo and nav must not collide; every nav label (incl. "How it works") stays on one line; nothing off-screen
    ctx = browser.new_context(viewport={'width': width, 'height': height})
    page = ctx.new_page()
    page.route('**/*supabase.co/**', lambda r: r.fulfill(status=201, content_type='application/json', body='{}'))
    page.goto(BASE + 'business.html', wait_until='networkidle')
    h = page.evaluate(HEADER_JS)
    p = f'[header {width}px] '
    split = [l['text'] for l in h['links'] if l['lines'] > 1 or (l['h'] - 12) > l['lh'] * 1.2]
    check(p + 'every nav label on one line', not split, ', '.join(split))
    b = h['brand']
    hit = [l['text'] for l in h['links'] if not (l['right'] <= b['left'] or l['left'] >= b['right'] or l['bottom'] <= b['top'] or l['top'] >= b['bottom'])]
    check(p + 'nav never overlaps the logo', not hit, ', '.join(hit))
    off = [l['text'] for l in h['links'] if l['left'] < 0 or l['right'] > h['vw']]
    check(p + 'every nav label fully on screen', not off, ', '.join(off))
    sw = page.evaluate('document.documentElement.scrollWidth')
    check(p + 'no horizontal page scroll', sw <= h['vw'], f'scrollWidth {sw} / clientWidth {h["vw"]}')
    page.screenshot(path=f'/out/header-{width}.png', clip={'x': 0, 'y': 0, 'width': width, 'height': 160})
    ctx.close()

def run(browser, width, height, label, mode='ok'):
    ctx = browser.new_context(viewport={'width': width, 'height': height})
    page = ctx.new_page()
    console_errors, page_errors, failed, intercepted, external = [], [], [], [], set()
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: page_errors.append(str(e)))
    page.on('requestfailed', lambda r: failed.append(r.url + ' ' + (r.failure or '')))
    def on_supabase(route):
        req = route.request
        intercepted.append({'url': req.url, 'method': req.method, 'body': req.post_data})
        if 'submit-business-application' in req.url:
            if mode == 'error':
                return route.fulfill(status=400, content_type='application/json', body=json.dumps({'error': 'That email is already registered.'}))
            if mode == 'offline':
                return route.abort()
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True}))
        return route.fulfill(status=201, content_type='application/json', body='{}')
    page.route('**/*supabase.co/**', on_supabase)
    page.on('request', lambda r: external.add(r.url.split('/')[2]) if not r.url.startswith(BASE) and not r.url.startswith('data:') else None)
    resp = page.goto(BASE + 'business.html', wait_until='networkidle')
    p = f'[{label}] '
    if mode == 'ok':
        check(p + 'page loads (HTTP 200) with a title', resp.status == 200 and page.title(), page.title())
        sw = page.evaluate('document.documentElement.scrollWidth'); cw = page.evaluate('document.documentElement.clientWidth')
        check(p + 'no horizontal page scroll', sw <= cw, f'scrollWidth {sw} / clientWidth {cw}')
        page.screenshot(path=f'/out/{label}-top.png')
        page.screenshot(path=f'/out/{label}-full.png', full_page=True)
        # owner 2026-10-11: the customer-preview mock shows no invented figure and no Interested count
        mock = page.inner_text('.phone')
        check(p + 'preview mock shows no Interested count', 'interested' not in mock.lower(), next((l for l in mock.splitlines() if 'interested' in l.lower()), ''))
        meta = page.inner_text('.mock-gathering-meta').strip()
        check(p + 'preview gathering line is the time only (no count)', meta == '7:00 PM', meta)
        # in-page anchors resolve
        anchors = page.evaluate("[...document.querySelectorAll('a[href^=\"#\"]')].map(a => a.getAttribute('href'))")
        missing = [a for a in set(anchors) if a != '#' and not page.query_selector(a)]
        check(p + f'all {len(set(anchors))} in-page anchors have a target', not missing, ', '.join(missing))
        # local links resolve
        hrefs = page.evaluate("[...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))")
        local = sorted({h.split('#')[0] for h in hrefs if h and not h.startswith(('#', 'http', 'mailto:', 'tel:', 'nearby:'))})
        bad = []
        for h in local:
            try:
                code = urllib.request.urlopen(BASE + h).status
            except Exception as e:
                code = str(e)
            if code != 200: bad.append(f'{h}:{code}')
        check(p + f'all {len(local)} local links return 200 ({", ".join(local)})', not bad, ', '.join(bad))
        ext = sorted({h for h in hrefs if h and h.startswith('http')})
        check(p + 'external links listed (not followed)', True, ', '.join(ext) or 'none')
        others = sorted({h for h in hrefs if h and h.startswith(('mailto:', 'tel:', 'nearby:'))})
        check(p + 'mailto/tel/app links listed', True, ', '.join(others) or 'none')
        # the form is hidden until a CTA reveals it; each of the three CTAs reveals it
        for cta in ['cta-btn', 'cta-btn-2', 'cta-btn-find']:
            page.evaluate("document.getElementById('apply').hidden = true")
            page.click('#' + cta)
            check(p + f'#{cta} reveals the application form', page.is_visible('#apply-form'))
        # validation, in order
        page.click('#apply-submit-btn')
        msgs = []
        def err(): return page.inner_text('#apply-error-box').strip()
        msgs.append(err())
        page.fill('#apply-business-name', 'Headless Test Cafe'); page.click('#apply-submit-btn'); msgs.append(err())
        check(p + 'empty submit asks for the business name first, then a category', msgs[0] == "Tell us your business's name." and msgs[1].startswith('Pick a category'), ' | '.join(msgs))
        # category search: coffee
        page.fill('#apply-type-search', 'coffee')
        labels = page.eval_on_selector_all('#apply-type-results button', 'b => b.map(x => x.textContent)')
        check(p + 'searching "coffee" offers Food & Drink -> Coffee', any('Coffee' in l for l in labels), ' / '.join(labels[:5]))
        page.click('#apply-type-results button >> nth=0')
        picked = page.inner_text('#apply-type-picked')
        check(p + 'picking it shows the chosen type', 'Coffee' in picked, picked.strip())
        check(p + 'activities / also / attributes sections appear', page.is_visible('#apply-activities-field') and page.is_visible('#apply-also-field') and page.is_visible('#apply-attrs-field'))
        acts = page.eval_on_selector_all('#apply-activities button', 'b => b.map(x => x.textContent)')
        check(p + '"What can customers do here?" lists activities', len(acts) > 0, ' / '.join(acts[:6]))
        # also-categories: cap of 5
        for q in ['tea', 'bakery', 'brunch', 'wine', 'dessert', 'breakfast', 'pastries']:
            page.fill('#apply-also-search', q)
            if page.query_selector('#apply-also-results button'):
                page.click('#apply-also-results button >> nth=0')
        n_also = page.eval_on_selector_all('#apply-also-picked button, #apply-also-picked span', 'b => b.length')
        check(p + 'other categories stop at 5', 0 < n_also <= 5, f'{n_also} picked after 7 tries')
        # customer-only tags (item 185) are never offered
        page.fill('#apply-also-search', 'date night')
        dn = page.eval_on_selector_all('#apply-also-results button', 'b => b.map(x => x.textContent)')
        check(p + 'customer-only "Date Night" is never offered', not any('Date Night' in x for x in dn), ' / '.join(dn) or 'no results')
        page.fill('#apply-also-search', '')
        page.click('#apply-submit-btn'); a = err()
        page.fill('#apply-address', '1 Test St, Boca Raton, FL'); page.click('#apply-submit-btn'); b = err()
        page.fill('#apply-name', 'Test Owner'); page.click('#apply-submit-btn'); c = err()
        page.fill('#apply-email', 'owner@example.com'); page.click('#apply-submit-btn'); d = err()
        page.fill('#apply-phone', '(555) 010-0100'); page.click('#apply-submit-btn'); e = err()
        check(p + 'then address, name, email, phone, authorization, each with its own message', [a, b, c, d, e] == ["Tell us your business's address.", 'Tell us your name.', 'Enter your email address.', 'Enter your phone number.', "Please confirm you're authorized to represent this business."], ' | '.join([a, b, c, d, e]))
        page.check('#apply-confirm')
    else:
        page.click('#cta-btn')
        page.fill('#apply-business-name', 'Headless Test Cafe')
        page.fill('#apply-category-text', 'small-batch coffee roaster')
        for sel, v in [('#apply-address', '1 Test St'), ('#apply-name', 'Test Owner'), ('#apply-email', 'owner@example.com'), ('#apply-phone', '(555) 010-0100')]:
            page.fill(sel, v)
        page.check('#apply-confirm')
    page.click('#apply-submit-btn')
    page.wait_for_timeout(800)
    sub = [r for r in intercepted if 'submit-business-application' in r['url']]
    if mode == 'ok':
        body = json.loads(sub[0]['body']) if sub else {}
        check(p + 'submit sends one application (intercepted, never reached the server)', len(sub) == 1, json.dumps({k: body.get(k) for k in ['businessName', 'category', 'subcategory', 'categories', 'attributes', 'confirmedRepresentative', 'website_confirm']}))
        check(p + 'success: form hides, confirmation shows the phone', page.is_hidden('#apply-form') and page.is_visible('#apply-success') and '(555) 010-0100' in page.inner_text('#apply-success'))
        page.screenshot(path=f'/out/{label}-success.png')
        ev = [json.loads(r['body'])['event'] for r in intercepted if 'business_acquisition_events' in r['url']]
        check(p + 'funnel events fired (intercepted, never written)', 'landing_viewed' in ev and 'cta_clicked' in ev, ', '.join(ev))
    elif mode == 'error':
        check(p + 'server error: its message shown, form kept, button re-enabled', page.inner_text('#apply-error-box').strip() == 'That email is already registered.' and page.is_visible('#apply-form') and page.is_enabled('#apply-submit-btn'))
    elif mode == 'offline':
        check(p + 'network failure: connection message, form kept, button re-enabled', 'Could not reach Nearby' in page.inner_text('#apply-error-box') and page.is_enabled('#apply-submit-btn'))
    real_failures = [f for f in failed if 'supabase.co' not in f]
    # in the error/offline runs the browser itself logs the one simulated failure ("Failed to load resource"); nothing else may log
    if mode != 'ok':
        console_errors = [m for m in console_errors if not m.startswith('Failed to load resource')]
    check(p + 'no console errors', not console_errors, ' | '.join(console_errors[:5]))
    check(p + 'no page (JavaScript) errors', not page_errors, ' | '.join(page_errors[:5]))
    check(p + 'no failed requests (other than the deliberate offline case)', not real_failures, ' | '.join(real_failures[:5]))
    if mode == 'ok':
        check(p + 'third-party hosts contacted', True, ', '.join(sorted(external)))
    ctx.close()

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    run(browser, 1280, 800, 'desktop')
    run(browser, 375, 812, 'phone')
    run(browser, 1280, 800, 'desktop-error', mode='error')
    run(browser, 1280, 800, 'desktop-offline', mode='offline')
    for w in [320, 360, 375, 390, 414, 600, 601, 768, 1024, 1280]:
        header_layout(browser, w)
    browser.close()
srv.terminate()
json.dump(results, open('/out/results.json', 'w'), indent=1)
print(f"\n{sum(r['ok'] for r in results)}/{len(results)} passed")

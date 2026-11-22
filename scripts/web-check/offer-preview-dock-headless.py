# Make an Offer preview dock (owner, 2026-11-22): phone-width headless check of the EXPORTED business website, every Supabase
# request mocked (nothing reaches it). Run like business-website-headless.py: EXPORT dir holding Nearby/business mounted at /site.
# Headless check of the EXPORTED business website (owner, 2026-11-14: website-only owners). Nothing reaches Supabase:
# every request to it is answered by a mock below, so no production read or write happens. Run from the repo root:
#   EXPORT=<dir holding Nearby/business> ; mkdir -p /tmp/bizweb-out
#   docker run --rm -v "$EXPORT":/site:ro -v "$PWD/scripts/web-check":/work:ro -v /tmp/bizweb-out:/out \
#     mcr.microsoft.com/playwright/python:v1.47.0-jammy bash -c "pip install -q playwright==1.47.0; python /work/business-website-headless.py"
# What it proves: the export loads, the signed-out / no-profile / not-linked / linked / email-link states render the right
# screen, the email link is removed from the address bar, and no page error is thrown. It does NOT prove a real sign-in,
# a real claim or a real offer (those need a real backend: see the report).
import json, subprocess, sys, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '--directory', '/site'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = 'http://127.0.0.1:8766/Nearby/business/'
REF = 'enmosvippabmuqslzrox'
UID = '11111111-1111-4111-8111-111111111111'
PARTNER = '22222222-2222-4222-8222-222222222222'
REQ = '33333333-3333-4333-8333-333333333333'
HEIGHT = {}
RADAR = {'on': False}  # a mocked get_aggregated_demand_for_partner (Match Radar scenario)
OPP = {'on': False, 'status': 'pending'}
PERF = {'on': False}  # mocked month figures (Offer Performance scenario); viewed_count is sent to prove it is never shown  # a mocked opportunity: 'pending' = the offer-form scenario, 'accepted' = a booking
# Writes the website is meant to send (mocked here): fire-and-forget business acquisition analytics (services/businessAcquisitionEvents.js).
PREVIEW_PLACEHOLDER = "What are you offering? e.g. Table for 4 at 7:30, 15% off the check"  # ui.bizDash3.whatAreYouOfferingE (en)
EXPECTED_WRITES = ('/rest/v1/business_acquisition_events',)
results = []
def check(name, ok, detail=''):
    results.append({'check': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

USER = {'id': UID, 'aud': 'authenticated', 'role': 'authenticated', 'phone': '15615550199', 'app_metadata': {'provider': 'phone'}, 'user_metadata': {}}
SESSION = {'access_token': 'mock.mock.mock', 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600,
           'refresh_token': 'mock-refresh', 'user': USER}

def profile_for(kind):
    if kind == 'none': return None
    p = {'id': UID, 'display_name': 'Web Owner (test)', 'birthdate': '1990-01-01', 'photo_url': f'{UID}/p.jpg', 'is_admin': False,
         'managed_partner_id': PARTNER if kind == 'linked' else None}
    return p

def run(browser, name, kind, query='', width=1280):
    ctx = browser.new_context(viewport={'width': width, 'height': HEIGHT.get(width, 900)})
    errors, writes, seen, noise = [], [], [], []
    page = ctx.new_page()
    page.on('pageerror', lambda e: (errors.append('pageerror: ' + str(e)[:200]), print('STACK', name, (e.stack or '')[:900], flush=True)))
    # The PostHog screen-autocapture error ("Couldn't find a navigation object") was fixed 2026-11-14 (App.web.js
    # autocapture={false}); it now counts as an error on every page, like any other console error.
    def on_console(m):
        if m.type != 'error': return
        if 'ERR_INTERNET_DISCONNECTED' in m.text: return  # fonts/CDN: the check runs with no network
        errors.append('console: ' + m.text[:200])
    page.on('console', on_console)
    prof = profile_for(kind)
    def handle(route):
        req = route.request; u = urlparse(req.url); path = u.path
        seen.append(req.method + ' ' + path)
        if req.method not in ('GET', 'HEAD', 'OPTIONS') and '/auth/v1/' not in path and '/rpc/' not in path and not path.endswith(EXPECTED_WRITES):
            writes.append(req.method + ' ' + path)
        single = 'vnd.pgrst.object' in (req.headers.get('accept') or '')
        def body(rows):
            if single:
                if not rows: return route.fulfill(status=406, content_type='application/json', body=json.dumps({'code': 'PGRST116', 'message': 'no rows'}))
                return route.fulfill(status=200, content_type='application/json', body=json.dumps(rows[0]))
            return route.fulfill(status=200, content_type='application/json', body=json.dumps(rows))
        if '/auth/v1/user' in path: return route.fulfill(status=200, content_type='application/json', body=json.dumps(USER))
        if '/auth/v1/' in path: return route.fulfill(status=200, content_type='application/json', body='{}')
        if path.endswith('/rest/v1/profiles') or path.endswith('/rpc/get_my_profile'): return body([prof] if prof else [])
        if path.endswith('/rpc/get_business_opportunities') and kind == 'linked' and OPP['on']:
            exp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 86400))
            day = time.strftime('%Y-%m-%d', time.gmtime(time.time() + 86400))
            return body([{'id': '44444444-4444-4444-8444-444444444444', 'request_id': REQ, 'status': OPP['status'], 'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                          'business_requests': {'id': REQ, 'status': 'open', 'category': 'Coffee', 'interest_tag': 'Coffee', 'party_size': 2,
                                                'date': day, 'expires_at': exp, 'attributes': [], 'summary': 'Coffee for 2 (mock)'}}])
        if path.endswith('/rpc/get_aggregated_demand_for_partner') and kind == 'linked' and RADAR['on']:
            base = {'total_party_size': None, 'soonest_date': None, 'dominant_period': None, 'dominant_period_count': None,
                    'dominant_occasion': None, 'dominant_occasion_count': None, 'is_demand_gap': False, 'offered_people': None}
            # is_demand_gap = never SERVED (audit 2026-11-14): true for the own, never-booked Coffee too; 🆕 only for Bowling
            return body([dict(base, category='Coffee', request_count=7, unmet_intent_count=5, is_offered=True, is_demand_gap=True),   # own category
                         dict(base, category='Bowling', request_count=6, unmet_intent_count=0, is_offered=False, is_demand_gap=True),  # outside it
                         dict(base, category=None, request_count=None, unmet_intent_count=None, is_offered=None, offered_people=7)])
        if kind == 'linked' and PERF['on']:
            if path.endswith('/rpc/get_partner_offer_funnel'): return body([{'opportunities': 24, 'offers_sent': 12, 'accepted': 5, 'redemptions': 4}])
            if path.endswith('/rpc/get_partner_offer_value'): return body([{'month_redemptions': 4, 'month_value': 120, 'month_unpriced': 0}])
            if path.endswith('/rpc/get_partner_offer_performance'):
                return body([{'group_key': 'g1', 'group_label': 'Coffee for two (mock)', 'offer_count': 3, 'viewed_count': 9, 'accepted_count': 2, 'completed_count': 1}])
        if path.endswith('/rest/v1/brand_partners'):
            return body([{'id': PARTNER, 'name': 'Test Cafe (mock)', 'category': 'food_drink', 'subcategory': 'Coffee', 'is_active': True}] if kind == 'linked' else [])
        return body([])
    # Everything that is neither the local site nor Supabase (mocked below) is refused, so results never depend on the
    # outside network (e.g. Cloudflare Turnstile answers 400 for the 127.0.0.1 host; fonts/CDN). Registered first:
    # Playwright gives the later Supabase routes precedence.
    page.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:8766/') else route.abort('internetdisconnected'))
    page.route('**/*supabase.co/**', handle)
    page.route('**/*.supabase.co/**', handle)
    if kind != 'signedout':
        page.add_init_script(f"localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(SESSION))});")
    page.goto(BASE + query, wait_until='networkidle')
    page.wait_for_timeout(2500)
    text = page.inner_text('body')
    page.screenshot(path=f'/out/{name}.png', full_page=True)
    out = {'noise': noise, 'text': text, 'errors': errors, 'writes': writes, 'url': page.url, 'seen': seen, 'page': page, 'ctx': ctx}
    return out


BOX = """(id) => { const e = document.querySelector('[data-testid="'+id+'"]'); if (!e) return null; const r = e.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,h:r.height,w:r.width,left:r.left,right:r.right}; }"""
def box(pg, id): return pg.evaluate(BOX, id)
def send_box(pg):
    return pg.evaluate("""() => { const d = document.querySelector('[data-testid="offer-preview-dock"]'); if (!d) return null;
      const el = [...d.querySelectorAll('[role=button]')].find(b => /Send Offer|Sending/.test(b.innerText)); if (!el) return null;
      const r = el.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,disabled: el.getAttribute('aria-disabled')}; }""")

with sync_playwright() as p:
    b = p.chromium.launch()
    OPP['on'] = True
    for (w, h) in [(320, 568), (375, 667), (390, 844), (430, 932)]:
        HEIGHT[w] = h; tag = f'[{w}x{h}]'
        r = run(b, f'dock_{w}', 'linked', '', width=w); pg = r['page']; before = len(r['errors'])
        try:
            pg.get_by_text('Opportunities', exact=True).first.click(); pg.wait_for_timeout(1200)
            pg.get_by_text('Accept & Offer', exact=True).first.click(); pg.wait_for_timeout(900)
            pg.get_by_text('Customize', exact=True).first.click(); pg.wait_for_timeout(1500)
        except Exception as e:
            check(f'{tag} opens Make an Offer', False, str(e)[:160]); r['ctx'].close(); continue
        check(f'{tag} opens Make an Offer', box(pg, 'offer-preview-dock') is not None)
        sb = send_box(pg)
        check(f'{tag} empty form: Send Offer on screen and disabled', sb and sb['bottom'] <= h and sb['top'] >= 0 and sb['disabled'] == 'true', str(sb))
        check(f'{tag} empty form: no preview toggle (nothing to preview yet)', box(pg, 'offer-preview-toggle') is None)
        pg.screenshot(path=f'/out/dock_{w}_1_empty.png')
        pg.get_by_placeholder(PREVIEW_PLACEHOLDER).first.fill('Two lattes for the price of one (test)'); pg.wait_for_timeout(700)
        tg = box(pg, 'offer-preview-toggle'); dk = box(pg, 'offer-preview-dock'); sb = send_box(pg)
        check(f'{tag} with a description: collapsed toggle line appears', tg is not None and tg['h'] <= 60, str(tg))
        toggle_text = pg.locator('[data-testid="offer-preview-toggle"]').inner_text()
        check(f'{tag} collapsed line names the preview + what the customer reads first', 'customer preview' in toggle_text.lower() and 'Two lattes' in toggle_text, toggle_text.replace('\n',' | '))
        check(f'{tag} collapsed: card not shown, dock small', box(pg, 'offer-preview-panel') is None and dk['h'] <= 140, f"dock h={dk['h']:.0f}")
        check(f'{tag} collapsed: Send Offer on screen and enabled', sb and sb['bottom'] <= h and sb['disabled'] != 'true', str(sb))
        pg.screenshot(path=f'/out/dock_{w}_2_collapsed.png')
        # scrolling the form leaves the dock where it is
        before_top = dk['top']
        pg.mouse.move(w / 2, 200); pg.mouse.wheel(0, 2500); pg.wait_for_timeout(500)
        check(f'{tag} scrolling the form keeps the dock in place', abs(box(pg, 'offer-preview-dock')['top'] - before_top) < 1)
        pg.mouse.wheel(0, -5000); pg.wait_for_timeout(400)
        pg.locator('[data-testid="offer-preview-toggle"]').click(); pg.wait_for_timeout(600)
        pn = box(pg, 'offer-preview-panel'); sb = send_box(pg)
        t = pg.inner_text('body')
        check(f'{tag} expanded: the customer card shows (business, description, button words)', pn is not None and 'Test Cafe (mock)' in t and "I'll take this one" in t, str(pn))
        check(f'{tag} expanded: panel bounded (<= 42% of the window)', pn and pn['h'] <= 0.42 * h + 1, f"panel h={pn and round(pn['h'])} of {h}")
        check(f'{tag} expanded: Send Offer still on screen', sb and sb['bottom'] <= h and sb['top'] >= 0, str(sb))
        exp = pg.locator('[data-testid="offer-preview-toggle"]').get_attribute('aria-expanded')
        check(f'{tag} toggle reports expanded to screen readers', exp == 'true', str(exp))
        pg.screenshot(path=f'/out/dock_{w}_3_expanded.png')
        # live update while expanded
        pg.get_by_placeholder(PREVIEW_PLACEHOLDER).first.fill('Three lattes, one free (test)'); pg.wait_for_timeout(700)
        pt = pg.locator('[data-testid="offer-preview-panel"]').inner_text()
        check(f'{tag} preview updates live while open', 'Three lattes, one free (test)' in pt and 'Two lattes' not in pt)
        pg.locator('[data-testid="offer-preview-toggle"]').click(); pg.wait_for_timeout(400)
        check(f'{tag} collapses again', box(pg, 'offer-preview-panel') is None)
        n0 = len(r['seen'])
        sb = send_box(pg)
        pg.mouse.click(w / 2, (sb['top'] + sb['bottom']) / 2); pg.wait_for_timeout(1500)
        sent = [x for x in r['seen'][n0:] if 'functions/v1' in x or '/rpc/' in x]
        check(f'{tag} Send Offer from the dock submits (mocked, nothing reaches Supabase)', any('screen-business-content' in x or 'submit' in x for x in sent), '; '.join(sent[:4]))
        pg.screenshot(path=f'/out/dock_{w}_4_after_send.png')
        check(f'{tag} no page errors', len(r['errors']) == before and not r['errors'], '; '.join(r['errors'][:3]))
        r['ctx'].close()
    b.close()
srv.terminate()
fails = [x for x in results if not x['ok']]
print(f'{len(results) - len(fails)}/{len(results)} passed')
json.dump(results, open('/out/results.json', 'w'), indent=1)

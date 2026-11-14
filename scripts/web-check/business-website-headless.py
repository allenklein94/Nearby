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
OPP = {'on': False}  # a mocked open opportunity (only for the offer-form scenario)
# Writes the website is meant to send (mocked here): fire-and-forget business acquisition analytics (services/businessAcquisitionEvents.js).
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

def run(browser, name, kind, query=''):
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    errors, writes, seen, noise = [], [], [], []
    page = ctx.new_page()
    page.on('pageerror', lambda e: (errors.append('pageerror: ' + str(e)[:200]), print('STACK', name, (e.stack or '')[:900], flush=True)))
    # Known noise (reported separately): the website's deliberately disabled PostHogProvider still runs its screen
    # autocapture, whose useNavigation call sits outside the NavigationContainer and logs an error. Nothing breaks.
    def on_console(m):
        if m.type != 'error': return
        if 'Couldn\'t find a navigation object' in m.text: noise.append(m.text[:80]); return
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
            return body([{'id': '44444444-4444-4444-8444-444444444444', 'request_id': REQ, 'status': 'pending', 'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                          'business_requests': {'id': REQ, 'status': 'open', 'category': 'Coffee', 'interest_tag': 'Coffee', 'party_size': 2,
                                                'date': day, 'expires_at': exp, 'attributes': [], 'summary': 'Coffee for 2 (mock)'}}])
        if path.endswith('/rest/v1/brand_partners'):
            return body([{'id': PARTNER, 'name': 'Test Cafe (mock)', 'category': 'Coffee', 'is_active': True}] if kind == 'linked' else [])
        return body([])
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

with sync_playwright() as p:
    b = p.chromium.launch()
    r = run(b, 'a_signed_out', 'signedout')
    check('[signed out] Login renders (phone code sign-in)', 'Sign in' in r['text'] or 'phone' in r['text'].lower(), r['text'][:120].replace('\n', ' | '))
    check('[signed out] no page errors', not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()

    r = run(b, 'b_no_profile', 'none')
    t = r['text']
    check('[no profile] CompleteProfile renders, not the dashboard', ('profile' in t.lower()) and ('Opportunities' not in t), t[:160].replace('\n', ' | '))
    dates = r['page'].locator('input[type=date]').count()
    check('[no profile] browser date field present', dates >= 1, f'{dates} date inputs')
    files = r['page'].locator('input[type=file]').count()
    check('[no profile] no app-install instruction', 'download the app' not in t.lower() and 'app store' not in t.lower())
    check('[no profile] no page errors', not r['errors'], '; '.join(r['errors'][:3]))
    print('   (file inputs in DOM: %d; photo picker may create one only on tap)' % files)
    r['ctx'].close()

    r = run(b, 'c_not_linked', 'complete')
    t = r['text']
    check('[profile, not linked] honest not-linked message, no dashboard', 'Opportunities' not in t, t[:200].replace('\n', ' | '))
    check('[profile, not linked] does not send people to the app', 'download the app' not in t.lower() and 'in the app' not in t.lower(), '')
    check('[profile, not linked] no page errors', not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()

    r = run(b, 'd_linked', 'linked')
    t = r['text']
    for tab in ['Home', 'Opportunities', 'Bookings', 'Availability', 'Profile']:
        check(f'[linked] dashboard shows {tab}', tab in t)
    for tab in ['Bookings', 'Availability', 'Profile', 'Home', 'Opportunities']:
        before = len(r['errors'])
        try:
            r['page'].get_by_text(tab, exact=True).first.click(); r['page'].wait_for_timeout(1200)
            ok = len(r['errors']) == before and len(r['page'].inner_text('body')) > 50
        except Exception as e:
            ok = False; r['errors'].append('click: ' + str(e)[:120])
        check(f'[linked] {tab} tab opens without an error', ok, '; '.join(r['errors'][before:][:2]))
    r['page'].screenshot(path='/out/d_linked_after_tabs.png', full_page=True)
    check('[linked] no page errors', not r['errors'], '; '.join(r['errors'][:3]))
    check('[linked] no unexpected table writes sent', not r['writes'], ', '.join(r['writes'][:5]))
    r['ctx'].close()

    r = run(b, 'e_email_link', 'linked', f'?n=business_opportunity_received&r={REQ}')
    t = r['text']; q = parse_qs(urlparse(r['url']).query)
    check('[email link] link removed from the address bar', 'r' not in q and 'n' not in q, r['url'])
    check('[email link] opens Opportunities (the push destination)', 'Opportunities' in t, t[:160].replace('\n', ' | '))
    check('[email link] unknown request = the dashboard\'s honest "isn\'t available anymore" line', 'isn\'t available anymore' in t, '')
    check('[email link] no page errors', not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()

    OPP['on'] = True
    r = run(b, 'g_offer_form', 'linked', f'?n=business_opportunity_received&r={REQ}')
    pg = r['page']; before = len(r['errors'])
    try:
        pg.get_by_text('Accept & Offer', exact=True).first.click(); pg.wait_for_timeout(1000)
        pg.get_by_text('Customize', exact=True).first.click(); pg.wait_for_timeout(1500)
        t = pg.inner_text('body')
        pg.screenshot(path='/out/g_offer_form.png', full_page=True)
        opened = ('Send Offer' in t) or ('Make an Offer' in t)
        check('[offer form] a linked request opens Make an Offer (where the fixed effect runs)', opened, t[-200:].replace('\n', ' | '))
    except Exception as e:
        check('[offer form] a linked request opens Make an Offer (where the fixed effect runs)', False, str(e)[:160])
    check('[offer form] no page errors while opening it', len(r['errors']) == before and not r['errors'], '; '.join(r['errors'][:3]))
    check('[offer form] nothing submitted (no offer sent)', not any('submit_business_offer' in x for x in r['seen']), '')
    r['ctx'].close()
    OPP['on'] = False

    r = run(b, 'f_bad_link', 'linked', '?n=DROP%20TABLE&r=not-a-uuid')
    check('[tampered link] dashboard still opens, no errors', 'Opportunities' in r['text'] and not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()
    b.close()

print('NOISE (not counted): disabled PostHogProvider logs "Couldn\'t find a navigation object" on every page')
srv.terminate()
json.dump(results, open('/out/results.json', 'w'), indent=1)
print(f"SUMMARY {sum(x['ok'] for x in results)}/{len(results)} passed")

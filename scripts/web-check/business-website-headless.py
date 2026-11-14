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
RADAR = {'on': False}  # a mocked get_aggregated_demand_for_partner (Match Radar scenario)
OPP = {'on': False, 'status': 'pending'}  # a mocked opportunity: 'pending' = the offer-form scenario, 'accepted' = a booking
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
        if path.endswith('/rest/v1/brand_partners'):
            return body([{'id': PARTNER, 'name': 'Test Cafe (mock)', 'category': 'food_drink', 'is_active': True}] if kind == 'linked' else [])
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
            body_text = r['page'].inner_text('body')
            ok = len(r['errors']) == before and len(body_text) > 50
            open(f'/out/tab_{tab}.txt', 'w').write(body_text)  # for review only (no check reads it)
            r['page'].screenshot(path=f'/out/tab_{tab}.png', full_page=True)
        except Exception as e:
            ok = False; r['errors'].append('click: ' + str(e)[:120])
        check(f'[linked] {tab} tab opens without an error', ok, '; '.join(r['errors'][before:][:2]))
    r['page'].screenshot(path='/out/d_linked_after_tabs.png', full_page=True)
    # Bookings (owner, 2026-11-14): with no bookings the tab says so FIRST, before hosted gatherings / communities.
    bt = open('/out/tab_Bookings.txt').read()
    nb, ng = bt.find('No bookings yet'), bt.find('No gatherings hosted yet')
    check('[linked] Bookings tab opens on "No bookings yet", before gatherings', nb >= 0 and (ng < 0 or nb < ng), f'bookings@{nb} gatherings@{ng}')
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

    OPP['on'] = True; OPP['status'] = 'accepted'
    r = run(b, 'h_booking', 'linked')
    pg = r['page']; before = len(r['errors'])
    try:
        pg.get_by_text('Bookings', exact=True).first.click(); pg.wait_for_timeout(1500)
        t = pg.inner_text('body'); pg.screenshot(path='/out/h_booking.png', full_page=True)
        nv, ng = t.lower().find('upcoming nearby visits'), t.find('No gatherings hosted yet')  # section headers render uppercased
        check('[booking] a confirmed visit is listed first on Bookings', nv >= 0 and (ng < 0 or nv < ng), f'visits@{nv} gatherings@{ng}')
        check('[booking] no "No bookings yet" beside a real booking', 'No bookings yet' not in t)
        check('[booking] party size uses the localized wording ("2 people")', '2 people' in t, t[nv:nv + 200].replace('\n', ' | ') if nv >= 0 else '')
    except Exception as e:
        check('[booking] a confirmed visit is listed first on Bookings', False, str(e)[:160])
    check('[booking] no page errors', len(r['errors']) == before and not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()
    OPP['on'] = False; OPP['status'] = 'pending'

    RADAR['on'] = True
    r = run(b, 'i_match_radar', 'linked')
    pg = r['page']; before = len(r['errors'])
    try:
        pg.get_by_text('More tools', exact=False).first.click(); pg.wait_for_timeout(800)
        pg.get_by_text('📈 Demand Signals', exact=True).first.click(); pg.wait_for_timeout(1200)
        t = pg.inner_text('body'); pg.screenshot(path='/out/i_match_radar.png', full_page=True)
        i = t.lower().find('match radar'); radar = t[i:] if i >= 0 else ''
        check('[match radar] opens from Home > More tools', i >= 0, t[-200:].replace('\n', ' | '))
        check('[match radar] lists demand outside the business\'s categories', '6 people nearby are looking for Bowling' in radar, radar[:300].replace('\n', ' | '))
        check('[match radar] never repeats its own-category request count (that lives in Opportunities)', '7 people' not in radar)
        check('[match radar] keeps the premium unmet searches for its own category', '5 recent searches near you for Coffee found nothing' in radar)
        check('[match radar] Home keeps its one-line preview of the own category', '7 people are looking for Coffee' in t[:i] if i >= 0 else False)
    except Exception as e:
        check('[match radar] opens from Home > More tools', False, str(e)[:160])
    try:
        check('[match radar] 🆕 "you don\'t currently offer this" only on the category it really doesn\'t offer', radar.count("You don't currently offer this") == 1, str(radar.count("You don't currently offer this")))
        check('[match radar] Home never says it doesn\'t offer its own category', 'Coffee — something you don' not in t)
    except Exception as e:
        check('[match radar] 🆕 "you don\'t currently offer this" only on the category it really doesn\'t offer', False, str(e)[:160])
    check('[match radar] no page errors', len(r['errors']) == before and not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()
    RADAR['on'] = False

    # Profile folded into groups (owner audit 2026-11-14): one open at a time, existing titles, nothing removed.
    r = run(b, 'j_profile_groups', 'linked')
    pg = r['page']; before = len(r['errors'])
    try:
        pg.get_by_text('Profile', exact=True).first.click(); pg.wait_for_timeout(1500)
        t = pg.inner_text('body'); pg.screenshot(path='/out/j_profile_groups.png', full_page=True); tl = t.lower()
        titles = ['Business Profile', 'What You Can Accommodate', "Who's this for?", 'What do you want more of?', 'Teach Nearby', 'Settings']
        check('[profile groups] the six group titles show', all(x in t for x in titles), ' / '.join(x for x in titles if x not in t))
        check('[profile groups] Business Profile open by default, the others closed', '✏️ Edit Profile' in t and 'what ages is it suited to?' not in tl and 'largest group you can host' not in tl)
        pg.get_by_role('button', name="Who's this for?", exact=True).first.click(); pg.wait_for_timeout(800)
        t2 = pg.inner_text('body'); t2l = t2.lower()
        check('[profile groups] opening "Who\'s this for?" shows its settings and closes Business Profile', 'what ages is it suited to?' in t2l and '✏️ Edit Profile' not in t2, t2[t2.find('Teach Nearby')-600:t2.find('Teach Nearby')].replace('\n', ' | '))
        pg.get_by_role('button', name='👥 What You Can Accommodate', exact=True).first.click(); pg.wait_for_timeout(800)
        t3 = pg.inner_text('body'); t3l = t3.lower()
        check('[profile groups] group size there is the routing value ("Largest group"), never the auto-reply range', 'largest group you can host' in t3l and 'groups of' not in t3l and 'what ages is it suited to?' not in t3l, f"largest={'largest group you can host' in t3l} groupsOf={'groups of' in t3l} ages={'what ages is it suited to?' in t3l}")
        pg.get_by_role('button', name='👥 What You Can Accommodate', exact=True).first.click(); pg.wait_for_timeout(800)
        t4 = pg.inner_text('body').lower()
        check('[profile groups] tapping the open group closes it', 'largest group you can host' not in t4)
    except Exception as e:
        check('[profile groups] the six group titles show', False, str(e)[:160])
    check('[profile groups] no page errors', len(r['errors']) == before and not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()

    r = run(b, 'f_bad_link', 'linked', '?n=DROP%20TABLE&r=not-a-uuid')
    check('[tampered link] dashboard still opens, no errors', 'Opportunities' in r['text'] and not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()
    b.close()

srv.terminate()
json.dump(results, open('/out/results.json', 'w'), indent=1)
print(f"SUMMARY {sum(x['ok'] for x in results)}/{len(results)} passed")

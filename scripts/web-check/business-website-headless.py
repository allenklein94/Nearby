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

def run(browser, name, kind, query='', width=1280, locale=None):
    ctx = browser.new_context(viewport={'width': width, 'height': 900}, **({'locale': locale} if locale else {}))
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
            return body([{'id': '44444444-4444-4444-8444-444444444444', 'request_id': REQ, 'partner_id': PARTNER, 'status': OPP['status'], 'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
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
    # The live Customer Preview (item 49, 2026-11-15 shared card styles): typing a description builds the customer's card
    # with its real button, shown but never live: clicking it sends nothing.
    try:
        pg.get_by_placeholder(PREVIEW_PLACEHOLDER).first.fill('Two lattes for the price of one (test)'); pg.wait_for_timeout(800)
        t = pg.inner_text('body')
        pg.screenshot(path='/out/g_offer_preview.png', full_page=True)
        check('[offer preview] typing a description builds the customer card', 'customer preview' in t.lower() and 'Two lattes for the price of one (test)' in t, '')
        check("[offer preview] shows the customer's button words", "I'll take this one" in t, '')
        pg.get_by_text("I'll take this one", exact=True).first.click(force=True); pg.wait_for_timeout(600)
        check('[offer preview] clicking the preview button sends nothing', not any(('submit_business_offer' in x) or ('accept_business_offer' in x) for x in r['seen']), '')
    except Exception as e:
        check('[offer preview] typing a description builds the customer card', False, str(e)[:160])
    check('[offer preview] no page errors', len(r['errors']) == before and not r['errors'], '; '.join(r['errors'][:3]))
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

    # Business Home request preview (owner, 2026-11-22): an open request shows on Home (category, party size, day), a click
    # opens that exact request in Opportunities; none open / booked = no section at all.
    import re as _re
    OPP['on'] = True; OPP['status'] = 'pending'
    r = run(b, 'j_home_requests', 'linked')
    pg = r['page']; before = len(r['errors'])
    try:
        t = pg.inner_text('body'); pg.screenshot(path='/out/j_home_requests.png', full_page=True)
        check('[home requests] an open request is previewed on Home', ('1 new request' in t.lower() or '1 NEW REQUEST' in t) and '2 people' in t, t[:300].replace('\n', ' | '))
        check('[home requests] "View opportunities" link shown', 'View opportunities' in t, '')
        check("[home requests] never the customer's own words (summary unused when a category exists)", 'Coffee for 2 (mock)' not in t, '')
        pg.get_by_role('button', name=_re.compile(r'^Coffee, 2 people')).first.click(); pg.wait_for_timeout(1500)
        t2 = pg.inner_text('body'); pg.screenshot(path='/out/j_home_requests_open.png', full_page=True)
        check('[home requests] a click opens that request in Opportunities (its own actions shown)', 'Accept & Offer' in t2, t2[:200].replace('\n', ' | '))
    except Exception as e:
        check('[home requests] a click opens that request in Opportunities (its own actions shown)', False, str(e)[:160])
    check('[home requests] no page errors', len(r['errors']) == before and not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()
    for status in ('accepted', None):
        if status: OPP['on'] = True; OPP['status'] = status
        else: OPP['on'] = False; OPP['status'] = 'pending'
        r = run(b, f'j_home_requests_{status or "none"}', 'linked')
        t = r['page'].inner_text('body')
        check(f'[home requests] {status or "no requests"}: no preview section, no placeholder', 'View opportunities' not in t and 'new request' not in t.lower().replace('0 new requests', ''), '')
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

    # Profile = Tell Nearby -> one reviewable summary -> tap a section to edit (owner, 2026-11-14); Teach Nearby merged.
    r = run(b, 'j_profile_groups', 'linked')
    pg = r['page']; before = len(r['errors'])
    import re as _re
    def grp(title):
        # a section header's name = title, or "title, <saved summary>"; other buttons may share the title's start, so pick
        # the header: the one carrying a summary, else the one whose text shows the open/closed mark
        cands = pg.get_by_role('button', name=_re.compile('^' + _re.escape(title))).all()
        for c in cands:
            if (c.get_attribute('aria-label') or '').startswith(title + ', '): return c
        for c in cands:
            txt = c.inner_text()
            if '›' in txt or '⌄' in txt: return c
        print('DEBUG candidates for', title, [(c.get_attribute('aria-label'), c.inner_text()[:60]) for c in cands])
        return cands[0]
    try:
        pg.get_by_text('Profile', exact=True).first.click(); pg.wait_for_timeout(1500)
        t = pg.inner_text('body'); pg.screenshot(path='/out/j_profile_groups.png', full_page=True); tl = t.lower()
        titles = ['What Nearby knows about your business', 'Business Profile', 'What You Can Accommodate', "Who's this for?", 'What do you want more of?', 'Settings']
        check('[profile summary] summary heading + the five section titles show', all(x.lower() in tl for x in titles), ' / '.join(x for x in titles if x.lower() not in tl))
        check('[profile summary] Teach Nearby merged into Tell Nearby (no second entry point)', 'Teach Nearby' not in t)
        check('[profile summary] Tell Nearby comes before the summary', 0 <= tl.find('tell nearby') < tl.find('what nearby knows about your business'), str(tl.find('tell nearby')))
        check('[profile summary] every section starts closed', '✏️ Edit Profile' not in t and 'what ages is it suited to?' not in tl and 'largest group you can host' not in tl)
        basics = grp('Business Profile').get_attribute('aria-label') or ''
        check('[profile summary] Business Profile header shows what is saved (Coffee)', 'Coffee' in basics, basics)
        acc = grp('👥 What You Can Accommodate').get_attribute('aria-label') or ''
        check('[profile summary] nothing saved for group size = "Not set", never the auto-reply range', 'Not set' in acc and 'Groups of' not in acc, acc)
        grp('Business Profile').click(); pg.wait_for_timeout(800)
        check('[profile summary] tapping Business Profile opens its existing controls', '✏️ Edit Profile' in pg.inner_text('body'))
        grp("Who's this for?").click(); pg.wait_for_timeout(800)
        t2 = pg.inner_text('body'); t2l = t2.lower()
        check('[profile groups] opening "Who\'s this for?" shows its settings and closes Business Profile', 'what ages is it suited to?' in t2l and '✏️ Edit Profile' not in t2)
        grp('👥 What You Can Accommodate').click(); pg.wait_for_timeout(800)
        t3 = pg.inner_text('body'); t3l = t3.lower()
        check('[profile groups] group size there is the routing value ("Largest group"), never the auto-reply range', 'largest group you can host' in t3l and 'groups of' not in t3l and 'what ages is it suited to?' not in t3l, f"largest={'largest group you can host' in t3l} groupsOf={'groups of' in t3l} ages={'what ages is it suited to?' in t3l}")
        grp('👥 What You Can Accommodate').click(); pg.wait_for_timeout(800)
        t4 = pg.inner_text('body').lower()
        check('[profile groups] tapping the open section closes it', 'largest group you can host' not in t4)
    except Exception as e:
        check('[profile summary] summary heading + the five section titles show', False, str(e)[:160])
    check('[profile groups] no page errors', len(r['errors']) == before and not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()

    # Temporary boost picker starts COLLAPSED (owner, 2026-11-23): no category chips until "See all (N)", typing searches
    # all of them, "Show less" closes it again; checked on a 320 / 390 / 1280 px wide window.
    for width in (320, 390, 1280):
        tag = f'[boost picker {width}px]'
        r = run(b, f'k_boost_{width}', 'linked', width=width)
        pg = r['page']; before = len(r['errors'])
        try:
            pg.get_by_text('Profile', exact=True).first.click(); pg.wait_for_timeout(1500)
            grp('What do you want more of?').click(); pg.wait_for_timeout(1000)
            t = pg.inner_text('body'); i = t.find('Temporary boost'); boost = t[i:i + 1500] if i >= 0 else ''
            pg.screenshot(path=f'/out/k_boost_{width}_closed.png', full_page=True)
            h_closed = pg.evaluate('document.documentElement.scrollHeight')
            check(f'{tag} section shows the boost heading + search box', i >= 0 and pg.get_by_placeholder('Search categories').count() >= 1, t[-200:].replace('\n', ' | '))
            check(f'{tag} collapsed: no category chips (Bowling / Pickleball absent)', 'Bowling' not in boost and 'Pickleball' not in boost, boost[:300].replace('\n', ' | '))
            see = pg.get_by_role('button', name=_re.compile(r'^See all \(\d+\)$'))
            check(f'{tag} one "See all (N)" link, N = the full list', see.count() == 1 and int(_re.search(r'\((\d+)\)', see.first.inner_text()).group(1)) > 200, see.first.inner_text() if see.count() else 'none')
            see.first.click(); pg.wait_for_timeout(800)
            t2 = pg.inner_text('body'); h_open = pg.evaluate('document.documentElement.scrollHeight')
            check(f'{tag} "See all" opens the full list in place', 'Bowling' in t2 and 'Pickleball' in t2 and len(t2) > len(t) + 1500, f'text closed={len(t)} open={len(t2)}')
            pg.get_by_role('button', name='Show less').first.click(); pg.wait_for_timeout(800)
            t_less = pg.inner_text('body')
            check(f'{tag} "Show less" closes it again', 'Bowling' not in t_less and abs(len(t_less) - len(t)) < 50, f'{len(t_less)} vs {len(t)}')
            box = pg.get_by_placeholder('Search categories').last
            box.fill('pickle'); pg.wait_for_timeout(800)
            t3 = pg.inner_text('body')
            check(f'{tag} typing searches the whole list while collapsed', 'Pickleball' in t3 and 'Bowling' not in t3)
            check(f'{tag} the See all link hides while searching', pg.get_by_role('button', name=_re.compile(r'^See all \(')).count() == 0)
            pg.get_by_text('Pickleball', exact=True).first.click(); pg.wait_for_timeout(600)
            box.fill(''); pg.wait_for_timeout(800)
            t4 = pg.inner_text('body'); j = t4.find('Temporary boost'); b4 = t4[j:j + 1200]
            pg.screenshot(path=f'/out/k_boost_{width}_selected.png', full_page=True)
            check(f'{tag} after clearing the search the chosen chip stays visible, nothing else', 'Pickleball' in b4 and 'Bowling' not in b4, b4[:300].replace('\n', ' | '))
            check(f'{tag} choosing a category still shows the existing duration choices', 'this weekend' in b4.lower() and '1 week' in b4.lower(), b4[:300].replace('\n', ' | '))
            check(f'{tag} no horizontal page scroll', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        except Exception as e:
            check(f'{tag} section shows the boost heading + search box', False, str(e)[:200])
        check(f'{tag} no page errors', len(r['errors']) == before and not r['errors'], '; '.join(r['errors'][:3]))
        r['ctx'].close()

    # Category chips show the TRANSLATED name (owner, 2026-11-23): in Spanish, "See all" lists "Bolos", never "Bowling".
    r = run(b, 'k_boost_es', 'linked', width=390, locale='es-ES')
    pg = r['page']; before = len(r['errors'])
    try:
        pg.get_by_text('Perfil', exact=True).first.click(); pg.wait_for_timeout(1500)
        grp('¿De qué quieres más?').click(); pg.wait_for_timeout(1000)
        pg.get_by_role('button', name=_re.compile(r'^Ver todo \(\d+\)$')).first.click(); pg.wait_for_timeout(800)
        t = pg.inner_text('body')
        check('[boost picker es] chips use the translated name (Bolos, not Bowling)', 'Bolos' in t and 'Bowling' not in t, t[:200].replace('\n', ' | '))
        check('[boost picker es] screen-reader label translated too', pg.get_by_role('button', name='Bolos', exact=True).count() >= 1)
        pg.get_by_placeholder('Buscar categorías').last.fill('bolo'); pg.wait_for_timeout(800)
        check('[boost picker es] searching the Spanish name finds it', 'Bolos' in pg.inner_text('body'))
        pg.screenshot(path='/out/k_boost_es.png', full_page=True)
    except Exception as e:
        check('[boost picker es] chips use the translated name (Bolos, not Bowling)', False, str(e)[:200])
    check('[boost picker es] no page errors', len(r['errors']) == before and not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()

    # Offer Performance (owner, 2026-11-15): four real counts as cells (2 x 2 on a phone, one row when wide), the value of
    # offers redeemed apart with its disclosure, the same disclosure on the Home tile, and no viewed count anywhere.
    PERF['on'] = True
    for width in (390, 1280):
        tag = f'[performance {width}px]'
        r = run(b, f'j_performance_{width}', 'linked', width=width)
        pg = r['page']; before = len(r['errors'])
        try:
            home = pg.inner_text('body')
            check(f'{tag} Home tile shows the value with its disclosure', 'Value of offers redeemed: $120' in home and 'Not a measure of what customers spent.' in home)
            pg.get_by_text('This month: 12 sent · 5 accepted · 4 redeemed', exact=True).first.click(); pg.wait_for_timeout(1500)
            t = pg.inner_text('body'); i = t.lower().find('offer performance'); perf = t[i:] if i >= 0 else ''
            pg.screenshot(path=f'/out/j_performance_{width}.png', full_page=True)
            check(f'{tag} the tile opens Offer Performance', i >= 0, t[-200:].replace('\n', ' | '))
            for label, n in (('Opportunities', 24), ('Offers sent', 12), ('Offers accepted', 5), ('Redemptions', 4)):
                check(f'{tag} cell {label} = {n}', f'{n}\n{label}' in perf, perf[:200].replace('\n', ' | '))
            check(f'{tag} value of offers redeemed + disclosure under the cells', perf.find('Value of offers redeemed') > perf.find('Redemptions') and '$120' in perf and 'Not a measure of what customers spent.' in perf)
            check(f'{tag} per-group line without a viewed count', '3 offered · 2 accepted · 1 redeemed' in perf and 'viewed' not in perf.lower() and '9' not in perf.split('Coffee for two (mock)')[-1][:60])
            boxes = [pg.get_by_text(lbl, exact=True).last.bounding_box() for lbl in ('Opportunities', 'Offers sent', 'Offers accepted', 'Redemptions')]
            rows = len({round(bx['y']) for bx in boxes if bx})
            check(f'{tag} cells laid out in {2 if width < 600 else 1} row(s)', rows == (2 if width < 600 else 1), str([bx and round(bx['y']) for bx in boxes]))
            check(f'{tag} no horizontal page scroll', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        except Exception as e:
            check(f'{tag} the tile opens Offer Performance', False, str(e)[:160])
        check(f'{tag} no page errors', len(r['errors']) == before and not r['errors'], '; '.join(r['errors'][:3]))
        r['ctx'].close()
    PERF['on'] = False

    r = run(b, 'f_bad_link', 'linked', '?n=DROP%20TABLE&r=not-a-uuid')
    check('[tampered link] dashboard still opens, no errors', 'Opportunities' in r['text'] and not r['errors'], '; '.join(r['errors'][:3]))
    r['ctx'].close()
    b.close()

srv.terminate()
json.dump(results, open('/out/results.json', 'w'), indent=1)
print(f"SUMMARY {sum(x['ok'] for x in results)}/{len(results)} passed")

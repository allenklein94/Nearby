#!/usr/bin/env python3
"""Screenshot the preview bundle (scripts/design/preview/build.sh) screen by screen, iPhone-sized, light + dark.

  python capture.py <export dir> <out dir> [screen ...]

Nothing reaches a backend: every request that isn't the local page is refused, and Supabase calls are answered from the
fixtures below (one signed-in, onboarded test person, three made-up gatherings, one test business). Fixtures are invented
and marked "(preview)"; no real account or row is used.
"""
import json, sys, time, subprocess, os, threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

SITE, OUT = sys.argv[1], sys.argv[2]
ONLY = sys.argv[3:]
os.makedirs(OUT, exist_ok=True)
PORT = 8771
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--directory', SITE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = f'http://127.0.0.1:{PORT}/'
REF = 'enmosvippabmuqslzrox'
UID = '11111111-1111-4111-8111-111111111111'
FRIEND = '22222222-2222-4222-8222-222222222222'
PARTNER = '33333333-3333-4333-8333-333333333333'
NOW = time.time()
iso = lambda t: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(t))
USER = {'id': UID, 'aud': 'authenticated', 'role': 'authenticated', 'phone': '15615550199', 'app_metadata': {'provider': 'phone'}, 'user_metadata': {}}
SESSION = {'access_token': 'mock.mock.mock', 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(NOW) + 3600,
           'refresh_token': 'mock-refresh', 'user': USER}
PROFILE = {'id': UID, 'display_name': 'Alex (preview)', 'bio': 'Coffee, trails and live music.', 'birthdate': '1994-05-01',
           'photo_url': None, 'photo_verified': True, 'profile_hidden': False, 'is_admin': False, 'is_premium': False,
           'interests': ['Coffee', 'Hiking', 'Live Music', 'Foodie'], 'interest_groups': ['Food & Drink', 'Outdoors'],
           'onboarding_motivations': ['Make friends', 'Find things to do'], 'open_to_friend_discovery': True,
           'social_comfort_level': '3-6', 'timezone': 'America/New_York', 'terms_accepted_at': iso(NOW - 86400 * 30),
           'created_at': iso(NOW - 86400 * 30), 'managed_partner_id': PARTNER, 'basics': {}, 'prompts': [],
           'relationship_intention': [], 'gender': None, 'dating_preferences_set': True, 'seen_home_first_run_moment': True,
           'friend_discovery_view_style': 'list', 'discovery_view_style': 'list', 'notification_mutes': []}

def g(i, title, tag, hours, attending, activity=None):
    return {'id': f'55555555-5555-4555-8555-55555555555{i}', 'title': title, 'interest_tag': tag, 'activity': activity,
            'description': 'Made-up gathering for the design preview.', 'start_time': iso(NOW + hours * 3600),
            'duration_minutes': 90, 'host_id': FRIEND if i != 2 else UID, 'capacity': 8, 'is_public': True, 'visibility': 'public',
            'women_only': False, 'status': 'active', 'location_name': 'Near Lake Worth Beach', 'area': 'Lake Worth Beach',
            'wide_area': '26.6,-80.0', 'approved_count': attending, 'attendee_count': attending, 'going_count': attending,
            'distance_miles': 0.6 + i, 'host': {'id': FRIEND, 'display_name': 'Sam (preview)', 'photo_url': None},
            'created_at': iso(NOW - 3600), 'image_url': None, 'price_level': None}
GATHERINGS = [g(1, 'Sunrise beach walk', 'Hiking', 14, 3), g(2, 'Italian dinner', 'Foodie', 30, 4, 'Dinner'),
              g(3, 'Open mic night', 'Live Music', 6, 6)]
PARTNER_ROW = {'id': PARTNER, 'name': 'Test Cafe (preview)', 'category': 'food_drink', 'subcategory': 'Coffee', 'is_active': True}

def respond(route):
    req = route.request; path = urlparse(req.url).path
    single = 'vnd.pgrst.object' in (req.headers.get('accept') or '')
    def body(rows):
        if single:
            if not rows: return route.fulfill(status=406, content_type='application/json', body=json.dumps({'code': 'PGRST116', 'message': 'no rows'}))
            return route.fulfill(status=200, content_type='application/json', body=json.dumps(rows[0]))
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(rows))
    if '/auth/v1/user' in path: return route.fulfill(status=200, content_type='application/json', body=json.dumps(USER))
    if '/auth/v1/' in path: return route.fulfill(status=200, content_type='application/json', body='{}')
    if '/storage/v1/' in path: return route.fulfill(status=200, content_type='application/json', body='[]')
    if '/functions/v1/' in path: return route.fulfill(status=200, content_type='application/json', body='{}')
    tail = path.rsplit('/', 1)[-1]
    if tail in ('profiles', 'get_my_profile', 'people_visible_to_me'): return body([PROFILE])
    if tail == 'brand_partners': return body([PARTNER_ROW])
    if tail == 'get_app_version_policy': return body([])
    if 'gathering' in tail and not any(k in tail for k in ('interest', 'feedback', 'message', 'invite', 'memor', 'count', 'state')):
        return body(GATHERINGS)
    return body([])

SCREENS = ONLY or ['Home', 'Discover', 'Create', 'CreateGathering', 'GatheringDetail', 'Profile', 'FriendDiscovery',
                   'Celebrate', 'Login', 'Activity', 'BusinessDashboard']
report = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for scheme in ('light', 'dark'):
        for name in SCREENS:
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, color_scheme=scheme, locale='en-US',
                                timezone_id='America/New_York')
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)[:160]))
            page.route('**/*', lambda r: r.continue_() if r.request.url.startswith(BASE) else r.abort('internetdisconnected'))
            page.route('**/*supabase.co/**', respond)
            signed = name != 'Login'
            init = f"localStorage.setItem('nearby-theme-preference', '{scheme}');"
            if signed:
                init += f"localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(SESSION))});"
            page.add_init_script(init)
            page.goto(BASE + '#' + name, wait_until='networkidle')
            page.wait_for_timeout(3500)
            page.screenshot(path=f'{OUT}/{name}-{scheme}.png', full_page=False)
            text = page.inner_text('body')
            report[f'{name}-{scheme}'] = {'errors': errs, 'preview_error': 'PREVIEW ERROR' in text, 'chars': len(text)}
            ctx.close()
    b.close()
srv.terminate()
json.dump(report, open(f'{OUT}/report.json', 'w'), indent=1)
for k, v in report.items():
    print(k, 'OK' if not v['errors'] and not v['preview_error'] and v['chars'] > 40 else 'CHECK', v['errors'][:1], v['chars'])

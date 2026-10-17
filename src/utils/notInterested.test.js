// Owner idea "153" (2026-10-17, LOCKED): "Not interested" on a recommended gathering card. Journey `notInterested` proves the
// server side per role; these pin the client rules and the locks (item 200's narrow exception, no motion, privacy).
const fs = require('fs');
const path = require('path');
const {
  canDismissRecommendation, dismissLowersKind, dismissedLineKey, hiddenRecommendationIds, withoutHidden, NOT_INTERESTED_SURFACES,
} = require('./notInterested');
const {
  experienceFeedbackFromRow, feedbackFor, feedbackDelta, applyExperienceFeedback, forTypedAsk, FEEDBACK_POINTS,
} = require('./experienceFeedback');
const { translate } = require('../i18n/translate');

const SRC = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
// Code only: comments may name things the code must not do.
const code = (txt) => txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else if (/\.(js|ts)$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

const NOW = Date.parse('2026-10-17T12:00:00Z');
const ME = 'me';
const upcoming = (extra = {}) => ({ id: 'g1', host_id: 'host', interest_tag: 'Coffee', scheduled_at: '2026-10-18T18:00:00Z', attendees: [], ...extra });

describe('which card offers Not interested', () => {
  const opts = { myUserId: ME, interestedIds: new Set(), now: NOW };
  test('an upcoming gathering the person has no relation to', () => {
    expect(canDismissRecommendation(upcoming(), opts)).toBe(true);
  });
  test('never their own, joined, requested, waitlisted or Interested gathering', () => {
    expect(canDismissRecommendation(upcoming({ host_id: ME }), opts)).toBe(false);
    for (const status of ['approved', 'pending', 'waitlisted']) {
      expect(canDismissRecommendation(upcoming({ attendees: [{ user_id: ME, status }] }), opts)).toBe(false);
    }
    expect(canDismissRecommendation(upcoming(), { ...opts, interestedIds: new Set(['g1']) })).toBe(false);
  });
  test('never when the viewer state or the Interested set is unknown, signed out, or the gathering is past', () => {
    expect(canDismissRecommendation(upcoming({ attendees: undefined }), opts)).toBe(false);
    expect(canDismissRecommendation(upcoming(), { ...opts, interestedIds: null })).toBe(false);
    expect(canDismissRecommendation(upcoming(), { ...opts, myUserId: null })).toBe(false);
    expect(canDismissRecommendation(upcoming({ scheduled_at: '2026-10-16T18:00:00Z' }), opts)).toBe(false);
  });
  test('three surfaces only', () => {
    expect(NOT_INTERESTED_SURFACES).toEqual(['home.pickedForYou', 'home.rightNow', 'discover.browse']);
  });
});

describe('the line says only what is true', () => {
  test('"less like this" only when a kind is really lowered', () => {
    expect(dismissLowersKind({ interest_tag: 'Coffee' })).toBe(true);
    expect(dismissLowersKind({ interest_tag: 'Faith & Spirituality' })).toBe(false);
    expect(dismissLowersKind({ interest_tag: null })).toBe(false);
    expect(translate('en', dismissedLineKey(true))).toBe("We'll show you less like this.");
    expect(translate('en', dismissedLineKey(false))).toBe("You won't see this one again.");
  });
  test('the hook starts from the kind and takes the server\'s answer, and a failed write puts the card back', () => {
    const hook = read('hooks/useNotInterested.js');
    expect(hook).toMatch(/kindDownRanked: dismissLowersKind\(g\)/);
    expect(hook).toMatch(/const \{ kindDownRanked \} = await dismissRecommendedGathering/);
    expect(hook).toMatch(/catch \(e\) \{\s*removeLine\(g\.id\);/);
  });
});

describe('what is hidden', () => {
  test('server list + this session\'s dismissals - this session\'s undos; a showing line keeps its place', () => {
    const feedback = experienceFeedbackFromRow({ dismissed_gathering_ids: ['a', 'b'] });
    const hidden = hiddenRecommendationIds(feedback, { dismissed: new Set(['c']), undone: new Set(['b']) }, ['c']);
    expect([...hidden].sort()).toEqual(['a']);
    expect(withoutHidden([{ id: 'a' }, { id: 'b' }, { id: 'c' }], hidden).map((g) => g.id)).toEqual(['b', 'c']);
  });
  test('Home leaves hidden ids out of weather, Best Pick / Picked For You and Nearby Right Now; Discover browsing only', () => {
    const home = read('screens/HomeScreen.js');
    expect(home).toMatch(/cardWithoutIds\([^\n]*\.\.\.notInterested\.hidden/);
    expect(home).toMatch(/const attention = selectHomeAttention\(\{[\s\S]{0,200}\.\.\.notInterested\.hidden/);
    expect(home).toMatch(/const rightNow = selectRightNow\(\{[\s\S]{0,200}\.\.\.notInterested\.hidden/);
    const discover = read('screens/DiscoverHubScreen.js');
    expect(discover).toMatch(/isSearching \? \(searchResultsFresh \? searchedGatherings : \[\]\) : browseGatherings/);
  });
});

describe('ranking: the kind, at full weight; never the host or business; a typed ask naming it ignores it', () => {
  const f = experienceFeedbackFromRow({ not_interested_categories: ['Coffee'], loved_host_ids: ['h-loved'] });
  test('lower by the full explicit weight, even at maturity 0; learned lift dropped', () => {
    const fb = feedbackFor({ hostId: 'h', partnerId: 'p', category: 'Coffee' }, f);
    expect(fb).toEqual({ direction: -1, scope: 'kind', reason: null, dropsLearned: true, explicit: true });
    expect(feedbackDelta(fb, 0)).toBe(-FEEDBACK_POINTS);
    // a "How was it?" word keeps its maturity scaling
    const nfm = feedbackFor({ category: 'Coffee' }, experienceFeedbackFromRow({ not_for_me_categories: ['Coffee'] }));
    expect(feedbackDelta(nfm, 0)).toBe(-0);
  });
  test('typed asks: lowered as history when the ask names another kind, ignored when it names Coffee', () => {
    const rows = [{ id: 1, category: 'Coffee', score: 10, historyScore: 0 }];
    expect(applyExperienceFeedback(rows, f, { maturity: 0 })[0].score).toBe(10 - FEEDBACK_POINTS);
    expect(applyExperienceFeedback(rows, forTypedAsk(f, ['Coffee']), { maturity: 0 })[0].score).toBe(10);
    const resolver = read('services/intentResolver.js');
    expect(resolver).toMatch(/const feedback = forTypedAsk\(await experienceFeedbackPromise, \[category, preferredTag, dateTag\]\);/);
  });
  test('every ranking surface turns feedback into points through feedbackDelta (no direct maturity scaling left)', () => {
    for (const rel of ['services/homeRecommendations.js', 'utils/homeAttention.js', 'screens/DiscoverHubScreen.js', 'utils/experienceFeedback.js']) {
      expect(read(rel)).not.toMatch(/\.direction \* feedbackWeight\(/);
    }
  });
});

describe('item 200 narrow exception: a quiet ⋯ on three surfaces, the card\'s one action unchanged', () => {
  const home = read('screens/HomeScreen.js');
  const discover = read('screens/DiscoverHubScreen.js');
  const users = walk(SRC).map((f) => path.relative(SRC, f)).filter((rel) => /NotInterestedMore/.test(read(rel)));
  test('only Home and Discover use it', () => {
    expect(users.sort()).toEqual(['components/NotInterested.js', 'screens/DiscoverHubScreen.js', 'screens/HomeScreen.js']);
  });
  test('Home: on the compact card (Picked For You + Nearby Right Now), never on Best Pick', () => {
    const entry = home.slice(home.indexOf('const renderAttentionEntry = '), home.indexOf('// Item 200 (owner, LOCKED)'));
    expect(entry).toMatch(/NotInterestedMore/);
    expect(entry.match(/renderGatheringCta\(/g)).toHaveLength(1); // still ONE primary action
    const hero = home.slice(home.indexOf('{attention.hero && (() => {'), home.indexOf('{attention.items.map(renderAttentionEntry)}'));
    expect(hero).not.toMatch(/NotInterested/);
    expect(home).toMatch(/\{attention\.items\.map\(renderAttentionEntry\)\}/);
    expect(home).toMatch(/\{rightNow\.map\(\(g\) => renderAttentionEntry\(/);
  });
  test('Discover: browse tiles only (never while searching), never typed-ask rows', () => {
    const tile = discover.slice(discover.indexOf('function renderGatheringTile('), discover.indexOf('// P1 UX critique reply item 14: a compact horizontal'));
    expect(tile).toMatch(/const canDismiss = !isSearching && notInterested\.eligible\(g\);/);
    const start = discover.indexOf('function renderIntentSearchResultRow');
    expect(start).toBeGreaterThan(-1);
    expect(discover.slice(start, start + 4000)).not.toMatch(/NotInterested/);
  });
  test('no motion: the pieces never animate', () => {
    for (const rel of ['components/NotInterested.js', 'hooks/useNotInterested.js']) {
      expect(code(read(rel))).not.toMatch(/Animated|LayoutAnimation|animateLayout|motion\//);
    }
  });
});

describe('privacy', () => {
  test('no app or edge-function source touches the table; only the service calls the three RPCs', () => {
    const roots = [SRC, path.join(SRC, '..', 'supabase', 'functions')];
    const files = roots.filter((r) => fs.existsSync(r)).flatMap((r) => walk(r)).filter((f) => !/journeys/.test(f));
    expect(files.filter((f) => /gathering_dismissals/.test(code(fs.readFileSync(f, 'utf8'))))).toEqual([]);
    const rpcUsers = files.filter((f) => /dismiss_recommended_gathering|forget_my_not_interested_category/.test(code(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(SRC, f));
    expect(rpcUsers).toEqual(['services/notInterested.js']);
  });
  test('no analytics, behavior event, push or AI call on the way', () => {
    for (const rel of ['services/notInterested.js', 'hooks/useNotInterested.js', 'components/NotInterested.js', 'utils/notInterested.js']) {
      expect(code(read(rel))).not.toMatch(/recordBehavior|behavior_events|track|analytics|logEvent|functions\.invoke|_send_push|anthropic/i);
    }
  });
  test('the migration: no client grant on the table; every function revoked from anon', () => {
    const sql = fs.readFileSync(path.join(SRC, '..', 'supabase', 'migrations', '20270327_gathering_not_interested.sql'), 'utf8');
    expect(sql).toMatch(/revoke all on table public\.gathering_dismissals from public, anon, authenticated;/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant [a-z, ]+ on (table )?public\.gathering_dismissals/i);
    for (const fn of ['dismiss_recommended_gathering(uuid)', 'undo_dismiss_recommended_gathering(uuid)', 'forget_my_not_interested_category(text)', 'clear_my_behavior_history()', 'get_my_experience_feedback()']) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon;`);
    }
  });
});

describe('strings', () => {
  test('every key in all 11 languages', () => {
    const keys = ['moreA11y', 'action', 'actionA11y', 'lessLikeThis', 'hiddenOnly', 'undo', 'undoA11y', 'settingsTitle', 'settingsHelper', 'forgetA11y', 'forgottenBody'];
    for (const lang of ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']) {
      for (const k of keys) expect(translate(lang, `ui.notInterested.${k}`, { title: 'X', category: 'Y' })).not.toMatch(/ui\.notInterested/);
    }
  });
});

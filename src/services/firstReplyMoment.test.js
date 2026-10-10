// The first-ever business reply moment + the live offer countdown (owner, 2026-10-10). Words, never more motion:
//   pill  "A local business just responded to your request", held a little longer (OFFER_ARRIVAL_FIRST_HOLD_MS)
//   card  "Your first reply from a local business" instead of "Heard your request", once
// Decided from the person's SERVER-side reply history (viewed_at + the earliest reply), never device state, so a second
// phone or a reinstall never shows it again. Also: "Valid until 7 PM" turns into "Ends in N min" on its own in every language.
const fs = require('fs');
const path = require('path');
import {
  createOfferArrivals, OFFER_ARRIVAL_HOLD_MS, OFFER_ARRIVAL_FIRST_HOLD_MS, OFFER_ARRIVAL_DEBOUNCE_MS,
} from './offerArrivals';
import { arrivalSignalTitle, arrivalSignalA11y, heardLine, isFirstEverReply } from '../utils/offerCopy';
import { setCurrentLanguage, hasOwnTranslation, translate } from '../i18n/translate';
import { validityRefreshDelayMs, nextValidityRefreshMs } from '../utils/offerMedia';
import { localWindow } from '../i18n/format';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];
const reply = (id, extra = {}) => ({ id, request_id: extra.request_id ?? 'req1', status: 'offered', viewed_at: null, request_status: 'open', partner_name: 'Coastal Coffee', offer_title: 'Latte for 4', ...extra });

// One server shared by every "device": the history lives there, not on a phone.
function server(initial = {}) {
  return { rows: [], viewedIds: new Set(), earliest: null, historyFails: false, ...initial };
}
const historyOf = (srv) => async () => {
  if (srv.historyFails) throw new Error('offline');
  return { seenAny: srv.viewedIds.size > 0, earliestReplyId: srv.earliest };
};

function device(srv, { withHistory = true } = {}) {
  const changes = [];
  const c = createOfferArrivals({
    fetchReplies: async () => srv.rows.map((r) => ({ ...r, viewed_at: srv.viewedIds.has(r.id) ? '2026-10-10T18:00:00Z' : null })),
    fetchFirstReplyState: withHistory ? historyOf(srv) : null,
    onChange: (s) => changes.push(s),
  });
  const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
  const check = async () => { c.check(); jest.advanceTimersByTime(OFFER_ARRIVAL_DEBOUNCE_MS); await flush(); };
  return { c, changes, check };
}

beforeEach(() => { jest.useFakeTimers(); setCurrentLanguage('en'); });
afterEach(() => { jest.useRealTimers(); setCurrentLanguage('en'); });

describe('the decision: server history only', () => {
  test('first-ever = never opened a reply AND this is the earliest reply ever sent', () => {
    expect(isFirstEverReply('o1', { seenAny: false, earliestReplyId: 'o1' })).toBe(true);
    expect(isFirstEverReply('o2', { seenAny: false, earliestReplyId: 'o1' })).toBe(false); // not the earliest
    expect(isFirstEverReply('o1', { seenAny: true, earliestReplyId: 'o1' })).toBe(false); // already opened one
    expect(isFirstEverReply('o1', null)).toBe(false); // lookup failed = normal wording
    expect(isFirstEverReply('o1', {})).toBe(false); // unknown = normal wording
    expect(isFirstEverReply(null, { seenAny: false, earliestReplyId: null })).toBe(false);
  });

  test('the history is read from the server (viewed_at + earliest responded reply, declines excluded), not from the device', () => {
    const src = read('services/offerArrivalSource.js');
    const fn = src.split('export async function fetchFirstReplyState')[1].split('\n}\n')[0];
    expect(fn).toMatch(/\.not\('viewed_at', 'is', null\)/);
    expect(fn).toMatch(/\.eq\('business_requests\.requester_id', userId\)/);
    expect(fn).toMatch(/\.order\('responded_at', \{ ascending: true \}\)/);
    expect(fn).toMatch(/\.neq\('status', 'declined'\)/);
    expect(fn).toMatch(/return null;/);
    for (const f of ['services/offerArrivalSource.js', 'services/offerArrivals.js', 'utils/offerCopy.js', 'screens/BusinessRequestDetailScreen.js']) {
      const code = read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code).not.toMatch(/AsyncStorage|localStorage|SecureStore/);
    }
  });
});

describe('the pill', () => {
  test('first-ever reply: the special wording, held longer', async () => {
    const srv = server({ earliest: 'o1' });
    const d = device(srv);
    await d.c.start();
    srv.rows.push(reply('o1'));
    await d.check();
    const s = d.c.getSignal();
    expect(s.firstEver).toBe(true);
    expect(arrivalSignalTitle(s)).toBe('A local business just responded to your request');
    expect(arrivalSignalA11y(s)).toBe('A local business just responded to your request. Opens it.');
    jest.advanceTimersByTime(OFFER_ARRIVAL_HOLD_MS);
    expect(d.c.getSignal()).not.toBeNull(); // still up past the normal hold
    jest.advanceTimersByTime(OFFER_ARRIVAL_FIRST_HOLD_MS - OFFER_ARRIVAL_HOLD_MS);
    expect(d.c.getSignal()).toBeNull();
    expect(d.changes.filter(Boolean)).toHaveLength(1); // decided before showing: never flips wording on screen
  });

  test('a later reply (one already opened) gets the normal wording and the normal hold', async () => {
    const srv = server({ earliest: 'o1', viewedIds: new Set(['o1']) });
    const d = device(srv);
    await d.c.start();
    srv.rows.push(reply('o2'));
    await d.check();
    expect(d.c.getSignal().firstEver).toBeUndefined();
    expect(arrivalSignalTitle(d.c.getSignal())).toBe('Coastal Coffee made you an offer');
    jest.advanceTimersByTime(OFFER_ARRIVAL_HOLD_MS);
    expect(d.c.getSignal()).toBeNull();
  });

  test('not the earliest reply (an older one was never opened): normal wording, nothing claimed', async () => {
    const srv = server({ earliest: 'o0' });
    const d = device(srv);
    await d.c.start();
    srv.rows.push(reply('o1'));
    await d.check();
    expect(d.c.getSignal().firstEver).toBeUndefined();
  });

  test('two replies at once read "2 offers came in"; a reply joining the first-ever pill turns it normal', async () => {
    const srv = server({ earliest: 'o1' });
    const d = device(srv);
    await d.c.start();
    srv.rows.push(reply('o1'), reply('o2'));
    await d.check();
    expect(d.c.getSignal().firstEver).toBeUndefined();
    expect(arrivalSignalTitle(d.c.getSignal())).toBe('2 offers came in');

    const srv2 = server({ earliest: 'a' });
    const d2 = device(srv2);
    await d2.c.start();
    srv2.rows.push(reply('a'));
    await d2.check();
    expect(d2.c.getSignal().firstEver).toBe(true);
    srv2.rows.push(reply('b'));
    await d2.check();
    expect(d2.c.getSignal().firstEver).toBeUndefined();
    expect(arrivalSignalTitle(d2.c.getSignal())).toBe('2 offers came in');
  });

  test('history lookup failing (or not wired) = the normal wording, the reply still announced', async () => {
    const srv = server({ earliest: 'o1', historyFails: true });
    const d = device(srv);
    await d.c.start();
    srv.rows.push(reply('o1'));
    await d.check();
    expect(d.c.getSignal().items).toHaveLength(1);
    expect(d.c.getSignal().firstEver).toBeUndefined();
    const srv3 = server({ earliest: 'o1' });
    const d3 = device(srv3, { withHistory: false });
    await d3.c.start();
    srv3.rows.push(reply('o1'));
    await d3.check();
    expect(d3.c.getSignal().firstEver).toBeUndefined();
  });

  test('cross-device: once opened on one phone, another phone (or a reinstall) never shows the moment again', async () => {
    const srv = server({ earliest: 'o1' });
    const phoneA = device(srv);
    await phoneA.c.start();
    srv.rows.push(reply('o1'));
    await phoneA.check();
    expect(phoneA.c.getSignal().firstEver).toBe(true);
    srv.viewedIds.add('o1'); // opened on phone A: the server records it
    const phoneB = device(srv); // a second phone / a fresh install: no local memory at all
    await phoneB.c.start();
    srv.rows.push(reply('o2'));
    await phoneB.check();
    expect(phoneB.c.getSignal().firstEver).toBeUndefined();
    expect(arrivalSignalTitle(phoneB.c.getSignal())).toBe('Coastal Coffee made you an offer');
  });
});

describe('the card', () => {
  test('first reply: "Your first reply from a local business"; every other: "Heard your request"', () => {
    expect(heardLine(true)).toBe('Your first reply from a local business');
    expect(heardLine(false)).toBe('Heard your request');
  });

  test('decided from server history BEFORE the screen marks anything viewed, once per visit, and only for the requester', () => {
    const screen = read('screens/BusinessRequestDetailScreen.js');
    const decide = screen.indexOf('await fetchFirstReplyState(uid)');
    const mark = screen.indexOf('unviewed.forEach((o) => markBusinessOfferViewed(o.id))');
    expect(decide).toBeGreaterThan(0);
    expect(mark).toBeGreaterThan(decide);
    expect(screen).toMatch(/if \(!firstReplyDecided\.current && unviewed\.length > 0 && result\.request\.requester_id === uid\)/);
    expect(screen).toMatch(/unviewed\.find\(\(o\) => isFirstEverReply\(o\.id, history\)\)/);
    expect(screen).toContain('{heardLine(firstReplyOfferId === o.id)}');
  });

  test('no new motion: the moment changes only words (and the pill hold)', () => {
    const screen = read('screens/BusinessRequestDetailScreen.js');
    const around = screen.slice(screen.indexOf('const [firstReplyOfferId'), screen.indexOf('const [firstReplyOfferId') + 800);
    expect(around).not.toMatch(/Animated|useReduceMotion/);
    const pill = read('components/OfferArrivalSignal.js');
    expect(pill).not.toMatch(/firstEver/); // the pill draws the same way; only its title (and hold) differ
  });
});

describe('all 11 languages', () => {
  test('both lines exist in every language, are their own, carry no placeholders, and differ from the normal wording', () => {
    for (const l of LANGS) {
      for (const key of ['ui.offerCopy.arrivalFirstEver', 'ui.offerCopy.firstReplyHeard']) {
        expect(hasOwnTranslation(l, key)).toBe(true);
        const text = translate(l, key);
        expect(text.trim().length).toBeGreaterThan(3);
        expect(text).not.toMatch(/[{}]/);
      }
      expect(translate(l, 'ui.offerCopy.firstReplyHeard')).not.toBe(translate(l, 'ui.offerCopy.heardYourRequest'));
      if (l !== 'en') expect(translate(l, 'ui.offerCopy.arrivalFirstEver')).not.toBe(translate('en', 'ui.offerCopy.arrivalFirstEver'));
    }
  });

  test('the pill and the card render in the person\'s language', () => {
    for (const l of LANGS) {
      setCurrentLanguage(l);
      expect(arrivalSignalTitle({ items: [{ offerId: 'o1', requestId: 'r', partnerName: 'X', offer: reply('o1') }], firstEver: true }))
        .toBe(translate(l, 'ui.offerCopy.arrivalFirstEver'));
      expect(heardLine(true)).toBe(translate(l, 'ui.offerCopy.firstReplyHeard'));
    }
  });

  test('the countdown wording reaches every language (Valid until -> Ends in N min -> expired)', () => {
    const now = new Date(2026, 9, 10, 18, 0);
    const at = (h, m) => new Date(2026, 9, 10, h, m).toISOString();
    for (const l of LANGS) {
      const later = localWindow({ end: at(21, 0) }, now, 'offer', l);
      const soon = localWindow({ end: at(18, 20) }, now, 'offer', l);
      expect(later).toBeTruthy();
      expect(soon).toBeTruthy();
      expect(soon).toContain('20');
      expect(soon).not.toBe(later);
      // the minute before expiry still counts down ("1"); the card's own expired line takes over after (isOfferExpired)
      const last = localWindow({ end: at(18, 1) }, now, 'offer', l);
      expect(last).toContain('1');
      expect(last).not.toBe(soon);
    }
    // English keeps its own formatter with the same decision
    expect(localWindow({ end: at(18, 20) }, now, 'offer', 'en')).toBe('Ends in 20 min');
  });
});

describe('the countdown updates on its own while the screen is open (text only)', () => {
  const now = new Date(2026, 9, 10, 18, 0, 0);
  const at = (h, m, s = 0) => new Date(2026, 9, 10, h, m, s).toISOString();

  test('waits until the 30-minute mark, then changes every minute, then once at expiry, then never', () => {
    expect(validityRefreshDelayMs(at(19, 0), now)).toBe(30 * 60000 + 50); // 18:30 = "Ends in 30 min"
    expect(validityRefreshDelayMs(at(18, 20), now)).toBe(60000 + 50); // 20 -> 19
    expect(validityRefreshDelayMs(at(18, 20, 30), now)).toBe(30000 + 50); // shows 21; becomes 20 in 30 s
    expect(validityRefreshDelayMs(at(18, 0, 40), now)).toBe(40000 + 50); // "Ends in 1 min" -> expired
    expect(validityRefreshDelayMs(at(17, 59), now)).toBeNull();
    expect(validityRefreshDelayMs(null, now)).toBeNull();
    expect(validityRefreshDelayMs('not a date', now)).toBeNull();
    expect(validityRefreshDelayMs(new Date(2026, 11, 1).toISOString(), now)).toBe(6 * 3600e3); // capped, re-checked
  });

  test('every scheduled moment really lands on a different label', () => {
    const end = at(18, 20);
    let t = now;
    for (let i = 0; i < 25; i += 1) {
      const d = validityRefreshDelayMs(end, t);
      if (d == null) break;
      const before = localWindow({ end }, new Date(t.getTime() + d - 100), 'offer', 'en');
      const after = localWindow({ end }, new Date(t.getTime() + d), 'offer', 'en');
      expect(after).not.toBe(before);
      t = new Date(t.getTime() + d);
    }
  });

  test('only open offers with a deadline count; the soonest wins', () => {
    expect(nextValidityRefreshMs([
      { status: 'offered', valid_until: at(18, 20) },
      { status: 'offered', valid_until: at(19, 0) },
      { status: 'accepted', valid_until: at(18, 5) },
      { status: 'offered', valid_until: null },
    ], now)).toBe(60000 + 50);
    expect(nextValidityRefreshMs([], now)).toBeNull();
  });

  test('the screen re-renders at that moment (setTimeout + cleanup), with no animation', () => {
    const screen = read('screens/BusinessRequestDetailScreen.js');
    const block = screen.slice(screen.indexOf('const [, setValidityTick]'), screen.indexOf('const displayOffers = useMemo'));
    expect(block).toMatch(/nextValidityRefreshMs\(offers\)/);
    expect(block).toMatch(/clearTimeout\(id\)/);
    expect(block).not.toMatch(/Animated|loop|pulse/i);
  });
});

describe('Reduce Motion and no urgency effects', () => {
  test('nothing new animates: no pulse, loop or extra effect for limited-time or first-ever offers', () => {
    for (const f of ['services/offerArrivals.js', 'utils/offerMedia.js', 'utils/offerCopy.js']) {
      const code = read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code).not.toMatch(/Animated|Easing|pulse|useReduceMotion/);
    }
  });
  test('the pill keeps its existing Reduce Motion handling unchanged', () => {
    const pill = read('components/OfferArrivalSignal.js');
    expect(pill).toMatch(/useReduceMotion|getReduceMotion/);
  });
});

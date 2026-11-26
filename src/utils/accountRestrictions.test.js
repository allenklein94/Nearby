// 20270399: the admin restriction control and what the person is told. The server is the authority (journey
// adminAccountRestrictions); these keep the screen truthful and the wording in the person's language.
import {
  RESTRICTION_CAPABILITIES, RESTRICTION_DAYS, activeRestrictions, restrictionFormReady, restrictionLabel, restrictionReasonReady,
  restrictionRefusal, restrictionRefusalMessage, restrictionStatusLine, toggleCapability,
} from './accountRestrictions';
import { recoverableErrorCopy, serviceError } from './recoverableError';
import { setCurrentLanguage as setLanguage } from '../i18n/translate';
import fs from 'fs';
import path from 'path';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const refusal = { message: 'This action is paused on your account', hint: 'account_restricted', details: '{"capability" : "messages", "until" : "2026-11-10T22:27:36Z"}', code: '42501' };

describe('the capabilities match the server', () => {
  test('the same six keys the migration accepts, every one labelled', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270399_admin_account_restrictions.sql'), 'utf8');
    const server = sql.match(/capability in \(([^)]*)\)/)[1].match(/'([a-z_]+)'/g).map((k) => k.slice(1, -1));
    expect(RESTRICTION_CAPABILITIES.map((c) => c.key).sort()).toEqual(server.sort());
    for (const c of RESTRICTION_CAPABILITIES) expect(c.label && c.covers).toBeTruthy();
  });
  test('durations stay inside the server limit of 1-30 days', () => {
    for (const d of RESTRICTION_DAYS) expect(d >= 1 && d <= 30).toBe(true);
  });
});

describe('the form', () => {
  test('needs a known action, an allowed duration and a 10-1000 character reason', () => {
    const ok = { capabilities: ['messages'], days: 3, reason: 'Repeated spam to strangers' };
    expect(restrictionFormReady(ok)).toBe(true);
    expect(restrictionFormReady({ ...ok, capabilities: [] })).toBe(false);
    expect(restrictionFormReady({ ...ok, capabilities: ['discovery'] })).toBe(false);
    expect(restrictionFormReady({ ...ok, days: 2 })).toBe(false);
    expect(restrictionFormReady({ ...ok, reason: 'spam' })).toBe(false);
    expect(restrictionReasonReady('x'.repeat(1001))).toBe(false);
    expect(restrictionFormReady(null)).toBe(false);
  });
  test('toggling keeps the display order and ignores unknown keys', () => {
    expect(toggleCapability(['links'], 'messages')).toEqual(['messages', 'links']);
    expect(toggleCapability(['messages', 'links'], 'messages')).toEqual(['links']);
    expect(toggleCapability([], 'discovery')).toEqual([]);
  });
});

describe('the admin status line', () => {
  const row = { restriction_id: 'r1', capability: 'messages', reason: 'Repeated spam to strangers', admin_name: 'Ana', expires_at: '2026-11-10T12:00:00Z', active: true, lifted_at: null };
  test('active only while marked active, not lifted and not past its end', () => {
    expect(activeRestrictions([row], NOW)).toHaveLength(1);
    expect(activeRestrictions([{ ...row, active: false }], NOW)).toHaveLength(0);
    expect(activeRestrictions([{ ...row, lifted_at: '2026-11-08T00:00:00Z' }], NOW)).toHaveLength(0);
    expect(activeRestrictions([{ ...row, expires_at: '2026-11-06T00:00:00Z' }], NOW)).toHaveLength(0);
  });
  test('says what is paused, until when, by whom and why', () => {
    expect(restrictionStatusLine(row)).toMatch(/^Messages paused until .+ · by Ana: Repeated spam to strangers$/);
    expect(restrictionStatusLine({ ...row, lifted_at: '2026-11-08T00:00:00Z', lift_reason: 'Reviewed again' })).toMatch(/^Messages · lifted .+: Reviewed again$/);
    expect(restrictionLabel('unknown')).toBe('unknown');
  });
});

describe('what the person is told', () => {
  afterEach(() => setLanguage('en'));
  test('reads the server refusal (capability + end)', () => {
    expect(restrictionRefusal(refusal)).toEqual({ capability: 'messages', until: new Date('2026-11-10T22:27:36Z') });
    expect(restrictionRefusal({ hint: 'account_suspended' })).toBe(null);
    expect(restrictionRefusal(null)).toBe(null);
  });
  test('the message names when it works again, never offers Try Again', () => {
    const copy = recoverableErrorCopy({ what: 'send that', error: refusal });
    expect(copy.canRetry).toBe(false);
    expect(copy.message).toMatch(/^Nearby paused this on your account after a review\. Available again: .+\. Everything else works as usual\.$/);
    expect(copy.message).not.toMatch(/\{date\}/);
  });
  test('an unreadable end never invents a date', () => {
    expect(restrictionRefusalMessage(restrictionRefusal({ hint: 'account_restricted', details: 'not json' })))
      .toBe('Nearby paused this on your account after a review.');
  });
  test('in another language too', () => {
    setLanguage('es');
    expect(restrictionRefusalMessage(restrictionRefusal(refusal), () => '10 de noviembre')).toBe(
      'Nearby pausó esto en tu cuenta tras una revisión. Disponible de nuevo: 10 de noviembre. Todo lo demás funciona con normalidad.'
    );
  });
});

// The six paused action paths (owner review of 0399, 2026-11-07): each one the app really uses reaches the shared copy
// above, never a block message, a generic "try again" or the server's English line. Shared paths (useChatComposer,
// presentRecoverableError) are covered by the tests above; these are the paths that used to bypass them.
describe('every paused action path shows the shared wording', () => {
  const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  test('business offers: the edge function passes the pause on with its detail, the app reads it', () => {
    setLanguage('en');
    const e = serviceError({ status: 400 }, { error: 'This action is paused on your account', code: 'account_restricted',
      details: JSON.stringify({ capability: 'offers', until: '2026-11-10T12:00:00Z' }) }, 'fallback');
    expect(restrictionRefusal(e)).toEqual({ capability: 'offers', until: new Date('2026-11-10T12:00:00Z') });
    const copy = recoverableErrorCopy({ what: 'send this offer', error: e, draftKept: true });
    expect(copy.canRetry).toBe(false);
    expect(copy.message).toMatch(/^Nearby paused this on your account after a review\./);
    const fn = src('../supabase/functions/screen-business-content/index.ts');
    // asked BEFORE screening or queuing (the app queues offers), and mapped if the write is refused anyway
    expect(fn.indexOf("rpc('get_my_account_restriction'")).toBeGreaterThan(0);
    expect(fn.indexOf("rpc('get_my_account_restriction'")).toBeLessThan(fn.indexOf("rpc('check_and_increment_ai_use'"));
    expect(fn).toMatch(/function writeRefusal\(err: any\) \{\s+const paused = restrictedRefusal\(err\);/);
    expect(fn).toMatch(/b\.code === 'account_restricted'\) patch = \{ status: 'not_sent'/);
  });
  test('friend requests: the pause (also 42501) is not turned into the block message', () => {
    const s = src('services/friends.js');
    expect(s.indexOf('if (restrictionRefusal(error)) throw error;')).toBeGreaterThan(0);
    expect(s.indexOf('if (restrictionRefusal(error)) throw error;')).toBeLessThan(s.indexOf("error.code === '42501'"));
  });
  test('Connect, notices and waves, and circle invites say what is paused (no Retry)', () => {
    expect(src('screens/FriendDiscoveryScreen.js')).toMatch(/if \(restrictionRefusal\(e\)\) \{ presentRecoverableError\(Alert/);
    const d = src('screens/DiscoveryScreen.js');
    expect(d).toMatch(/if \(restrictionRefusal\(insertError\)\) \{ presentRecoverableError\(Alert/);
    expect(d).toMatch(/if \(restrictionRefusal\(updateError\)\) \{ presentRecoverableError\(Alert/);
    expect(src('components/GatheringPublishedPanel.js')).toMatch(/restrictionRefusal\(r\.reason\)/);
    expect(src('hooks/useChatComposer.js')).toMatch(/restrictionRefusalMessage\(paused\)/);
  });
});

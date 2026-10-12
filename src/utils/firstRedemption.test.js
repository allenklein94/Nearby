// Owner item 52 (2026-10-12): the first successful redemption is memorable. The customer's earliest-ever completed offer
// shows one more line under "✓ Visit confirmed": "You used Nearby to turn a request into a real-world experience."
// Words only (no new motion, haptic or glow), only that one offer, decided from the SERVER (earliest completed_at among
// offers on the person's own requests), never device state; unknown or failed = the normal card.
import fs from 'fs';
import path from 'path';
import { presentOffer } from './offerPresentationEngine';
import { setCurrentLanguage, hasOwnTranslation } from '../i18n/translate';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const code = (f) => read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];
const NOW = new Date(2026, 9, 12, 15, 0);
const visited = (extra = {}) => ({ id: 'o1', status: 'completed', offer_type: 'standard', business_reservations: [{ status: 'confirmed' }], ...extra });
const ctx = (extra = {}) => ({ context: { now: NOW, playedIds: new Set(), ...extra } });
const NOTE = 'You used Nearby to turn a request into a real-world experience.';

beforeEach(() => setCurrentLanguage('en'));
afterEach(() => setCurrentLanguage('en'));

describe('the decision (presentOffer, the one presentation source)', () => {
  test('the first-ever redemption gets the line under Visit confirmed', () => {
    const c = presentOffer(visited(), ctx({ isFirstRedemption: true })).confirmation;
    expect(c.visitConfirmed).toBe(true);
    expect(c.firstVisitNote).toBe(NOTE);
  });
  test('every later redemption: the normal card', () => {
    expect(presentOffer(visited(), ctx()).confirmation.firstVisitNote).toBeNull();
    expect(presentOffer(visited(), ctx({ isFirstRedemption: false })).confirmation.firstVisitNote).toBeNull();
  });
  test('only a real visit: never on a booked, open or closed reply, never in the owner preview, only a real true', () => {
    expect(presentOffer(visited({ status: 'accepted' }), ctx({ isFirstRedemption: true })).confirmation.firstVisitNote).toBeNull();
    expect(presentOffer(visited({ status: 'offered' }), ctx({ isFirstRedemption: true })).confirmation).toBeNull();
    expect(presentOffer(visited({ status: 'cancelled' }), ctx({ isFirstRedemption: true })).confirmation).toBeNull();
    expect(presentOffer(visited(), ctx({ viewer: 'owner_preview', isFirstRedemption: true })).confirmation).toBeNull();
    expect(presentOffer(visited(), ctx({ isFirstRedemption: 'yes' })).confirmation.firstVisitNote).toBeNull();
  });
  test('words only: the card itself is unchanged (same heading, same rendering, no extra play)', () => {
    const a = presentOffer(visited(), ctx({ isFirstRedemption: true }));
    const b = presentOffer(visited(), ctx());
    const { firstVisitNote: _a, ...ca } = a.confirmation;
    const { firstVisitNote: _b, ...cb } = b.confirmation;
    expect(ca).toEqual(cb);
    expect(a.rendering).toBe(b.rendering);
  });
  test('every language has its own wording, none says "just" (it stays true on every later look)', () => {
    for (const lang of LANGS) expect(hasOwnTranslation(lang, 'ui.requestDetail.firstVisitNote')).toBe(true);
    expect(NOTE).not.toMatch(/\bjust\b/i);
  });
});

describe('the source: server history, read with the offers', () => {
  test('the earliest completed offer on the person\'s own requests, null on failure', () => {
    const src = read('services/offerArrivalSource.js');
    const fn = src.split('export async function fetchFirstRedemptionId')[1].split('\n}\n')[0];
    expect(fn).toMatch(/\.eq\('business_requests\.requester_id', userId\)/);
    expect(fn).toMatch(/\.eq\('status', 'completed'\)/);
    expect(fn).toMatch(/\.order\('completed_at', \{ ascending: true \}\)/);
    expect(fn).toMatch(/\.limit\(1\)/);
    expect(fn).toMatch(/return null;/);
    for (const f of ['services/offerArrivalSource.js', 'screens/BusinessRequestDetailScreen.js', 'utils/offerPresentationEngine.js']) {
      expect(code(f)).not.toMatch(/AsyncStorage|localStorage|SecureStore/);
    }
  });
  test('the screen reads it in the same parallel read as the logos (the line never pops in) and only for the requester', () => {
    const screen = code('screens/BusinessRequestDetailScreen.js');
    expect(screen).toMatch(/askFirstRedemption = !firstRedemptionRef\.current && result\.request\.requester_id === uid/);
    expect(screen).toMatch(/askFirstRedemption \? fetchFirstRedemptionId\(uid\) : null/);
    expect(screen).toMatch(/isFirstRedemption: firstRedemptionOfferId === o\.id/);
    expect(screen).toMatch(/<VisitConfirmed [^>]*note=\{confirmation\.firstVisitNote\}/);
  });
  test('no motion of its own: the note sits inside VisitConfirmed\'s one settle', () => {
    const vc = code('motion/VisitConfirmed.js');
    expect(vc).toMatch(/\{note \? <Text style=\{\[styles\.note/);
    expect((vc.match(/Animated\.timing/g) ?? []).length).toBe(1);
    expect(vc).not.toMatch(/Haptics/);
  });
});

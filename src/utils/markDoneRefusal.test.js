// V10 (owner 2026-11-21): a customer's refused "Mark as done" shows ONE neutral line in their language, never the server's raw
// English sentence and never anything that reveals a business's private no-show record (2026-09-27 decision kept).
const fs = require('fs');
const path = require('path');
import { isMarkDoneRefusal, MARK_DONE_REFUSED_SERVER_MESSAGE } from './visitConfirmation';
import strings from '../i18n/ui/requestDetail';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];

describe('neutral refusal for "Mark as done"', () => {
  test('matches exactly the sentence the server raises for every non-completable state', () => {
    const sql = read('supabase/migrations/20270430_business_visit_confirmation.sql');
    const fn = sql.slice(sql.indexOf('function public.complete_business_reservation'), sql.indexOf('function public.mark_business_no_show'));
    // offer not booked, reservation missing / not confirmed (requested, failed, cancelled), no-show: all the same sentence
    expect(fn.split(`raise exception '${MARK_DONE_REFUSED_SERVER_MESSAGE}'`).length - 1).toBe(3);
    expect(isMarkDoneRefusal(new Error(MARK_DONE_REFUSED_SERVER_MESSAGE))).toBe(true);
  });

  test('every other refusal keeps its own path', () => {
    for (const m of [
      'You can mark this as completed on the day of the visit.',
      'You are not part of this reservation.',
      'Offer not found.',
      'Failed to fetch',
      'This reservation is not in a state that can be cancelled.',
      '',
    ]) expect(isMarkDoneRefusal(new Error(m))).toBe(false);
    expect(isMarkDoneRefusal(null)).toBe(false);
    expect(isMarkDoneRefusal(undefined)).toBe(false);
  });

  test('the line exists in all 11 languages and never mentions a no-show or the business', () => {
    for (const l of LANGS) {
      const s = strings[l].cantMarkDone;
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(5);
    }
    expect(strings.en.cantMarkDone).toBe("This booking can't be marked as done.");
    expect(strings.en.cantMarkDone).not.toMatch(/show|business|no longer|record/i);
  });

  test('the customer screen uses it, without Try Again, and re-reads the booking', () => {
    const src = read('src/screens/BusinessRequestDetailScreen.js');
    const fn = src.slice(src.indexOf('async function handleComplete('), src.indexOf('function handleCancelReservation('));
    expect(fn).toMatch(/if \(isMarkDoneRefusal\(e\)\) \{\s*Alert\.alert\(t\('ui\.shared\.errors\.didntGoThrough'\), t\('ui\.requestDetail\.cantMarkDone'\)\);\s*load\(\);/);
    expect(fn).toMatch(/else \{\s*presentRecoverableError\(Alert, \{ what: 'complete that', error: e, onRetry: \(\) => handleComplete\(offerId\) \}\);/);
  });

  test('the business side is unchanged (it knows its own records)', () => {
    const src = read('src/screens/BusinessDashboardScreen.js');
    expect(src).not.toMatch(/isMarkDoneRefusal|cantMarkDone/);
  });
});

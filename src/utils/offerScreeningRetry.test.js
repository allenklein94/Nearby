// Offer screening automatic retry (owner, 2026-11-15; migration 20270420). Which failures the server retries by itself,
// and guards on how screen-business-content uses it. The database side (schedule, claim, stop, publish once) is the
// journey src/journeys/offerScreeningRetry.journey.js. Not covered here: a real Anthropic outage or a real cron run.
import fs from 'fs';
import path from 'path';
import { screeningFailureKind } from '../../supabase/functions/_shared/screeningFailure';
import { submissionView, inFlightRequestIds } from './offerSubmission';

const root = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const edge = read('supabase/functions/screen-business-content/index.ts');
const classifier = read('supabase/functions/_shared/contentClassifier.ts');
const migration = read('supabase/migrations/20270420_offer_screening_auto_retry.sql');

describe('which screening failures are retried automatically', () => {
  test.each([408, 409, 425, 429, 500, 502, 503, 504, 529])('HTTP %i is temporary', (status) => {
    expect(screeningFailureKind({ status })).toBe('transient');
  });
  test.each([400, 401, 402, 403, 404, 413, 422])('HTTP %i (billing, key, bad request) is permanent: never retried', (status) => {
    expect(screeningFailureKind({ status })).toBe('permanent');
  });
  test('no answer at all (network, timeout) or an unreadable answer is temporary', () => {
    expect(screeningFailureKind({})).toBe('transient');
    expect(screeningFailureKind()).toBe('transient');
    expect(screeningFailureKind({ status: 200 })).toBe('transient');
  });
});

describe('the classifier says what kind of failure it was, and stays fail-closed', () => {
  test('every failure path of the detailed call returns a failure, never a tier', () => {
    const body = classifier.slice(classifier.indexOf('export async function classifyContentDetailed'));
    expect(body).not.toMatch(/return null/);
    // 4 with 0387's missing-key path (integration), 3 without it
    expect((body.match(/return \{ failure:/g) || []).length).toBe(4);
  });
  test('the old classifyContent keeps its null-on-failure contract for its other callers', () => {
    expect(classifier).toMatch(/return 'failure' in r \? null : r;/);
  });
});

describe('screen-business-content: the automatic retry path', () => {
  test('only the service key with a claimed submission starts a run, and it acts for the submitter', () => {
    expect(edge).toMatch(/token === SERVICE_ROLE_KEY && typeof body\?\.autoRetrySubmissionId === 'string'/);
    expect(edge).toMatch(/sub\.status !== 'reviewing' \|\| sub\.dismissed_at\) return json\(\{ skipped: true \}, 200\)/);
    expect(edge).toMatch(/myId = sub\.submitted_by;/);
  });
  test('a cleared retry publishes through the server-only wrapper (sent + marked published together)', () => {
    expect(edge).toMatch(/autoRetry\s*\? await admin\.rpc\('_submit_business_offer_for_submission'/);
    expect(edge).toMatch(/: await supabaseAsUser\.rpc\('submit_business_offer', offerArgs\)/);
  });
  test('every screening outage goes through the one recorder with its kind', () => {
    expect(edge).toMatch(/if \(m\.service\) return unavailable\(m\.failure\);/);
    expect(edge).toMatch(/if \('failure' in c\) return unavailable\(c\.failure\);/);
    expect(edge).not.toMatch(/return UNAVAILABLE;/);
    expect((edge.match(/'_record_offer_screening_unavailable'/g) || []).length).toBe(3);
  });
  test('Try again clears a pending automatic try (so the two can never both run)', () => {
    expect(edge).toMatch(/attempts: \(sub\.attempts \?\? 1\) \+ 1, next_retry_at: null/);
  });
  test('automatic tries never spend the owner\'s daily AI allowance', () => {
    expect(edge).toMatch(/autoRetry \? \{ data: true \} : await admin\.rpc\('check_and_increment_ai_use'/);
  });
});

describe('the schedule and the server-only rule', () => {
  test('about 30 s, 2 min, 5 min, then Try again only', () => {
    expect(migration).toMatch(/when 0 then interval '30 seconds' when 1 then interval '2 minutes'\s+when 2 then interval '5 minutes' else null/);
  });
  test('no new function is callable by a client', () => {
    for (const fn of ['_record_offer_screening_unavailable', 'claim_due_offer_screening_retries', '_submit_business_offer_for_submission', 'dispatch_offer_screening_retries']) {
      const grants = migration.split('\n').filter((l) => l.startsWith('grant') && l.includes(fn));
      grants.forEach((l) => expect(l).not.toMatch(/authenticated|anon/));
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
    }
  });
});

describe('what the owner sees (existing wording, unchanged)', () => {
  test('a pending automatic try reads as still being reviewed, with nothing to press', () => {
    const v = submissionView({ status: 'reviewing' });
    expect(v.tone).toBe('progress');
    expect(v.actions).toEqual([]);
  });
  test('after the automatic tries, Try again is back', () => {
    expect(submissionView({ status: 'unavailable' }).actions).toContain('retry');
  });
  test('a request with a pending try still counts as in flight (no second send)', () => {
    expect(inFlightRequestIds([{ status: 'reviewing', request_id: 'r1' }]).has('r1')).toBe(true);
  });
});

describe('integration with 0387 screening health (one classification)', () => {
  const { screeningFailureKind: retryKind } = require('../../supabase/functions/_shared/screeningFailure');
  test('credit, key and retired-model causes are never retried, whatever the status', () => {
    for (const healthKind of ['credit', 'credentials', 'model']) expect(retryKind({ status: 500, healthKind })).toBe('permanent');
  });
  test('rate limits, timeouts and provider errors still retry', () => {
    for (const [status, healthKind] of [[429, 'rate_limit'], [undefined, 'timeout'], [529, 'provider_error']]) expect(retryKind({ status, healthKind })).toBe('transient');
  });
});

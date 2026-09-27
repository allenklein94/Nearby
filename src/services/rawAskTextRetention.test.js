// Raw ask text retention (migration 20270237, owner decision LOCKED: structured forever, raw text 180 days).
// The data layer enforces it (scripts/live-verify/raw-ask-text-retention.sql proves the live behavior); these
// guards keep the code from growing a second copy or reading the text back, and keep search behavior unchanged.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MIGRATION = read('supabase/migrations/20270237_raw_ask_text_retention.sql');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel, out); } else out.push(rel);
  }
  return out;
}

const mockInsert = jest.fn();
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })) }));
jest.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } } })) },
    from: jest.fn(() => ({
      insert: (row) => {
        mockInsert(row);
        return { select: () => ({ single: async () => ({ data: { id: 's1' }, error: null }) }), then: (f) => f({ error: null }) };
      },
    })),
  },
}));

describe('raw ask text retention', () => {
  test('180 days, set by the server, cleared (never deleted) by an hourly job', () => {
    expect(MIGRATION).toMatch(/raw_ask_retention_days\(\)\s*returns integer language sql immutable as \$\$ select 180 \$\$/);
    expect(MIGRATION).toMatch(/new\.raw_text_expires_at := now\(\) \+ make_interval/);
    expect(MIGRATION).toMatch(/new\.raw_text_expires_at := old\.raw_text_expires_at/);
    expect(MIGRATION).toMatch(/Ask text can only be cleared, never rewritten/);
    expect(MIGRATION).toMatch(/cron\.schedule\('purge-expired-raw-ask-text', '40 \* \* \* \*'/);
    const purge = MIGRATION.slice(MIGRATION.indexOf('function public.purge_expired_raw_ask_text'));
    const body = purge.slice(0, purge.indexOf('end $$'));
    expect(body).not.toMatch(/\bdelete\b/i);
    // Only the text column is written; every structured column is left alone.
    const sets = body.match(/\bset\s+[^;]*?\bwhere/gi);
    expect(sets).toHaveLength(2);
    sets.forEach((s) => expect(s).toMatch(/^set raw_text = null where$/i));
    expect(MIGRATION).toMatch(/revoke all on function public\.purge_expired_raw_ask_text\(\) from public, anon, authenticated/);
  });

  test('both approved copies are covered', () => {
    for (const t of ['intent_submissions', 'intent_outcomes']) {
      expect(MIGRATION).toContain(`create trigger raw_ask_text_retention before insert or update on public.${t}`);
      expect(MIGRATION).toContain(`update ${t} set raw_text = null where raw_text is not null and raw_text_expires_at <= now()`);
    }
  });

  test('no migration or edge function copies the ask text out of the ask tables', () => {
    const files = [
      ...fs.readdirSync(path.join(ROOT, 'supabase/migrations')).map((f) => `supabase/migrations/${f}`),
      ...walk('supabase/functions').filter((f) => /\.(ts|js)$/.test(f)),
    ];
    const reads = /select\b[^;()]*\b(\w+\.)?raw_text\b[^;()]*\bfrom\s+(public\.)?intent_(submissions|outcomes)\b/i;
    const offenders = files.filter((f) => reads.test(read(f)));
    expect(offenders).toEqual([]);
  });

  test('the app writes the text in one place and never reads it back', () => {
    const src = walk('src').filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f));
    const writers = src.filter((f) => /from\('intent_(submissions|outcomes)'\)[\s\S]{0,80}\.(insert|upsert)\(/.test(read(f)));
    expect(writers).toEqual(['src/services/intentOutcomes.js']);
    for (const f of src) {
      const s = read(f);
      const chains = s.match(/from\('intent_(submissions|outcomes)'\)[\s\S]{0,200}?\.select\('([^']*)'\)/g) || [];
      chains.forEach((c) => expect(c.replace(/^[\s\S]*\.select\(/, '')).not.toMatch(/raw_text|\*/));
    }
    // The client never tries to set its own expiry.
    expect(read('src/services/intentOutcomes.js')).not.toMatch(/raw_text_expires_at/);
  });

  test('search logging is unchanged: the (redacted) ask is still recorded with its structured fields', async () => {
    const { recordIntentSubmission, recordIntentSelection } = require('./intentOutcomes');
    const id = await recordIntentSubmission({
      rawText: 'vegan dinner with my wife tonight', category: 'Restaurants', dateWindow: 'tonight',
      intentKind: 'gathering', hadAnyResult: true, reachedBusinessFallback: false, partySize: 2,
    });
    expect(id).toBe('s1');
    const sub = mockInsert.mock.calls[0][0];
    expect(sub).toMatchObject({ user_id: 'u1', category: 'Restaurants', date_window: 'tonight', intent_kind: 'gathering',
      had_any_result: true, party_size: 2 });
    expect(typeof sub.raw_text).toBe('string');
    expect(sub.raw_text).not.toMatch(/vegan/i);
    expect(sub).not.toHaveProperty('raw_text_expires_at');
    await recordIntentSelection({ rawText: 'dinner tonight', category: 'Restaurants', resultType: 'gathering', resultId: 'g1', submissionId: 's1' });
    expect(mockInsert.mock.calls[1][0]).toMatchObject({ raw_text: 'dinner tonight', result_type: 'gathering', result_id: 'g1', submission_id: 's1' });
  });
});

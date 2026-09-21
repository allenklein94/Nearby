// Migration 20270201: a gathering's business request snapshots the gathering's DECLARED attributes (owner decision 2026-09-21).
const fs = require('fs');

const sql = fs.readFileSync(require.resolve('../../supabase/migrations/20270201_gathering_request_attributes.sql'), 'utf8');
const code = sql.replace(/^--.*$/gm, '');
const { BUSINESS_ATTRIBUTE_OPTIONS } = require('../constants/businessAttributes');

describe('gathering -> business request attributes', () => {
  it('both request creators write the snapshot through the one helper, at insert time', () => {
    expect(code.match(/public\._gathering_request_attributes\(gathering_id_param\)/g).length).toBe(2);
    expect(code).toMatch(/note_for_business, attributes\s*\n\s*\) values/);
    expect(code).toMatch(/gathering_id, attributes\s*\n\s*\) values/);
  });
  it('copies only the host-declared features, never the beginner_friendly default', () => {
    expect(code).toMatch(/unnest\(coalesce\(g\.features/);
    expect(code).not.toMatch(/beginner_friendly/);
  });
  it('adds no plan kind or social context to the request', () => {
    ['party_type', 'partyType', 'friends', 'attendee', 'gathering_interest', 'display_name'].forEach((w) => expect(code).not.toContain(w));
  });
  it('the helper is not callable by clients and the creators keep one signature', () => {
    expect(code).toMatch(/revoke all on function public\._gathering_request_attributes\(uuid\) from public, anon, authenticated/);
    expect(code).not.toMatch(/drop function/i);
  });
  it('every gathering feature is a key of the one business attribute vocabulary', () => {
    const features = fs.readFileSync(require.resolve('../../supabase/migrations/20270198_accessibility_family_features.sql'), 'utf8')
      .match(/gatherings_features_check check \(\s*features <@ array\[([^\]]*)\]/)[1]
      .split(',').map((x) => x.trim().replace(/'/g, ''));
    const vocab = BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key);
    features.forEach((f) => expect(vocab).toContain(f));
  });
});

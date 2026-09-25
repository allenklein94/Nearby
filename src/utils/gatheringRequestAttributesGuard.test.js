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
  it('every gathering feature is a key of the one business attribute vocabulary, and the client list matches the LATEST live constraint', () => {
    const migDir = require('path').join(__dirname, '../../supabase/migrations');
    const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
    let latestMatch = null;
    for (const f of files) {
      const m = fs.readFileSync(require('path').join(migDir, f), 'utf8')
        .match(/gatherings_features_check check \(\s*features <@ array\[([^\]]*)\]/);
      if (m) latestMatch = m;
    }
    expect(latestMatch).not.toBeNull();
    const dbFeatures = latestMatch[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort();
    const vocab = BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key);
    dbFeatures.forEach((f) => expect(vocab).toContain(f));
    const { GATHERING_FEATURE_KEYS } = require('./gatheringPractical');
    expect([...GATHERING_FEATURE_KEYS].sort()).toEqual(dbFeatures);
  });

  it('the business never learns or scores the gathering plan kind (friends / date / family)', () => {
    const scorer = fs.readFileSync(require.resolve('../services/businessOfferRecommendation.js'), 'utf8');
    const dash = fs.readFileSync(require.resolve('../screens/BusinessDashboardScreen.js'), 'utf8');
    expect(scorer).not.toMatch(/requestPartyType|Matches who this is for/);
    expect(dash).not.toMatch(/requestPartyType|gatherings\?\.party_type/);
    const fix = fs.readFileSync(require.resolve('../../supabase/migrations/20270202_business_payload_no_party_type.sql'), 'utf8').replace(/^--.*$/gm, '');
    expect(fix).not.toContain('party_type');
    expect(fix).toContain("'price_level', g.price_level");
  });
});

// Item 55 (2026-09-25): the owner asked for richer business-matching context (outdoor preference among it),
// but explicitly kept the party-type/plan-kind privacy invariant from 20270202 locked. Outdoor seating is a
// concrete VENUE preference the host can declare, not social context, so it joins the SAME closed feature list
// -- never a second field, never inferred, and the plan-kind invariant above must still hold.
describe('outdoor seating is a declarable gathering feature (owner item 55, not a reopening of plan kind)', () => {
  const widenSql = fs.readFileSync(require.resolve('../../supabase/migrations/20270203_gathering_outdoor_seating_feature.sql'), 'utf8');
  it('widens the existing closed list in place, not a new column or table', () => {
    expect(widenSql).toMatch(/gatherings_features_check check \(\s*features <@ array\[[^\]]*'outdoor_seating'/);
    expect(widenSql).not.toMatch(/create table/i);
    expect(widenSql).not.toMatch(/party_type/);
  });
  it('the client feature list carries it, using the shared business attribute vocabulary label', () => {
    const { GATHERING_FEATURE_OPTIONS } = require('./gatheringPractical');
    const opt = GATHERING_FEATURE_OPTIONS.find((o) => o.key === 'outdoor_seating');
    expect(opt).toBeDefined();
    expect(BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key)).toContain('outdoor_seating');
  });
  it('reaches the opportunity payload only through the existing attributes snapshot -- no new business-facing field', () => {
    // create_business_request_for_gathering / _route_gathering_to_partner already insert `attributes` from
    // `_gathering_request_attributes(gathering_id_param)`, which reads `gatherings.features` verbatim (test above).
    // Widening the CHECK is therefore the entire server-side change; nothing else needed to touch the payload.
    expect(code).toMatch(/gathering_id, attributes\s*\n\s*\) values/);
  });
});

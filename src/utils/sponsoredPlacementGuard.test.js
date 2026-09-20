const fs = require('fs');
const path = require('path');
import { SPONSORED_LABEL, ORGANIC_ONLY_PHRASES, sponsoredWhyText } from '../constants/sponsored';

// Item 44 (sponsored placement, phase 1). These guards keep paid placements separate from organic content:
// the label cannot be omitted, organic code never touches the sponsored tables, the serving function accepts no
// profile/behavior inputs, nothing is sellable by default, and there is no device-local cap fallback.
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const mig = read('supabase/migrations/20270154_sponsored_placements.sql');

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(f) && !/\.test\.js$/.test(f)) out.push(full);
  }
  return out;
}

describe('disclosure cannot be omitted', () => {
  const card = read('src/components/SponsoredCard.js');
  it('the label is a constant rendered by the component, never a data field', () => {
    expect(SPONSORED_LABEL).toBe('Sponsored');
    expect(card).toMatch(/SPONSORED_LABEL/);
    expect(card).not.toMatch(/card\.(label|is_sponsored|sponsored)/);
  });
  it('the card renders the label twice (pill + byline) and an accessibility label that starts with it', () => {
    expect((card.match(/\{SPONSORED_LABEL\}/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(card).toMatch(/accessibilityLabel=\{`\$\{SPONSORED_LABEL\}:/);
  });
  it('offers "Why am I seeing this?", Hide and Report, and a plain View CTA', () => {
    for (const t of ['Why am I seeing this?', 'Hide this sponsor', 'Report this ad', '>View<']) expect(card).toContain(t);
  });
  it('the disclosure sentence says it is paid and not activity-based', () => {
    expect(sponsoredWhyText('Cafe', 'Food & Drink')).toMatch(/paid to be shown/);
    expect(sponsoredWhyText('Cafe', 'Food & Drink')).toMatch(/isn't based on your activity/);
  });
});

describe('no organic-response language inside the sponsored components', () => {
  it.each(['src/components/SponsoredCard.js', 'src/components/SponsoredSpotlightSlot.js', 'src/services/sponsored.js'])('%s', (f) => {
    const src = read(f);
    for (const phrase of ORGANIC_ONLY_PHRASES) expect(src).not.toContain(phrase);
  });
  it('the sponsored card does not use the organic card or reason helpers', () => {
    const card = read('src/components/SponsoredCard.js');
    for (const bad of ['PlaceCard', 'recommendationFacts', 'becauseYouLikeReason', 'friendGoingReason', 'offerCopy']) expect(card).not.toContain(bad);
  });
});

describe('organic code never touches the sponsored system', () => {
  const allowed = [
    'src/components/SponsoredCard.js', 'src/components/SponsoredSpotlightSlot.js', 'src/services/sponsored.js',
    'src/constants/sponsored.js', 'src/components/SponsoredPromotionsPanel.js', 'src/utils/sponsoredPromotions.js', 'src/screens/DiscoverHubScreen.js', 'src/screens/SettingsScreen.js',
  ].map((p) => path.join(root, p));
  const pattern = /sponsored_|get_sponsored|record_sponsored|SponsoredCard|SponsoredSpotlight|services\/sponsored|constants\/sponsored|show_sponsored_places/;
  it('no other source file references it', () => {
    const offenders = walk(path.join(root, 'src')).filter((f) => !allowed.includes(f) && pattern.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
  it('no other migration references the sponsored tables (organic SQL never reads them)', () => {
    const dir = path.join(root, 'supabase/migrations');
    const offenders = fs.readdirSync(dir)
      .filter((f) => !['20270154_sponsored_placements.sql', '20270155_sponsored_purchase_and_payments.sql', '20270156_sponsored_owner_stats.sql', '20270157_sponsored_refunds_and_approvals.sql'].includes(f))
      .filter((f) => /sponsored_(placements|payments|seen|hidden|daily_stats|price)|sponsorable_category|get_sponsored|show_sponsored_places/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('DiscoverHub renders the slot only on the Places and Perks tabs, never in the blended view or a search', () => {
    const src = read('src/screens/DiscoverHubScreen.js');
    expect(src).toMatch(/typeFilter === 'places' && !isSearching && \(\s*<SponsoredSpotlightSlot/);
    expect(src).toMatch(/typeFilter === 'perks' && !isSearching && \(\s*<SponsoredSpotlightSlot/);
    expect((src.match(/<SponsoredSpotlightSlot/g) || []).length).toBe(2);
  });
});

describe('serving function is contextual only', () => {
  const fnStart = mig.indexOf('create or replace function public.get_sponsored_spotlight(');
  const sig = mig.slice(fnStart, mig.indexOf(') returns table', fnStart));
  it('accepts only a position and the browse category', () => {
    expect(sig).toMatch(/lat_param double precision/);
    expect(sig).toMatch(/lng_param double precision/);
    expect(sig).toMatch(/category_group_param text/);
    expect((sig.match(/_param /g) || []).length).toBe(3);
  });
  const body = mig.slice(fnStart, mig.indexOf('-- A tap is counted', fnStart));
  it.each(['behavior_events', 'interests', 'interest_groups', 'onboarding', 'business_requests', 'intent_submissions',
    'matches', 'friend', 'gathering_interest', 'occasion', 'birth', 'gender'])('never reads %s', (t) => {
    expect(body).not.toContain(t);
  });
  it('reads a profile column only to suppress (the switch)', () => {
    const profileReads = body.match(/from profiles[^;]*/g) || [];
    expect(profileReads).toEqual(['from profiles where id = v_uid']);
    expect(body).toMatch(/select show_sponsored_places into v_show/);
  });
  it('does not persist or return the viewer position', () => {
    expect(body).not.toMatch(/insert into[^;]*(lat_param|lng_param)/);
    expect(body).not.toMatch(/return query select[^;]*(lat_param|lng_param)/);
  });
  it('fixed 10 mile radius, 7 day rolling cap keyed on the business, atomic', () => {
    expect(body).toMatch(/<= 10/);
    expect(body).toMatch(/interval '7 days'/);
    expect(body).toMatch(/on conflict \(user_id, partner_id\) do update/);
  });
  it('tie-break uses payment time and id only (never price)', () => {
    expect(body).toMatch(/order by \(select min\(y\.paid_at\)[^)]*\), sp\.id/);
    expect(body).not.toMatch(/amount_cents/);
  });
});

describe('paid status and sellability are system-derived and fail closed', () => {
  it('serving requires a paid payment row, screening, allow-list, window and active business', () => {
    const pred = mig.slice(mig.indexOf('_sponsored_placement_servable(p'), mig.indexOf('-- Serving function'));
    for (const k of ["status in ('scheduled', 'active')", "y.status = 'paid'", "screening_tier = 'low'", 'sponsorable_category_groups', 'b.active = true', 'now() < p.ends_at']) expect(pred).toContain(k);
    expect(pred).toMatch(/coalesce\(/);
  });
  it('the allow-list ships empty in every migration', () => {
    const dir = path.join(root, 'supabase/migrations');
    for (const f of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/insert into (public\.)?sponsorable_category_groups/i);
  });
  it('no is_sponsored / paid flag column exists on any organic table, only the consumer suppress switch', () => {
    const dir = path.join(root, 'supabase/migrations');
    for (const f of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/\bis_sponsored\b|\bis_promoted\b/i);
    expect(mig).toMatch(/add column if not exists show_sponsored_places boolean not null default true/);
    expect((mig.match(/alter table public\.\w+\s+add column/gi) || []).length).toBe(1);
  });
  it('the sponsored tables grant nothing to clients and the RPCs are not anon-callable', () => {
    expect(mig).toMatch(/revoke all on public\.%I from public, anon, authenticated/);
    expect(mig).not.toMatch(/grant (select|insert|update|delete|all)[^;]* on public\.sponsored/i);
    for (const fn of ['get_sponsored_spotlight', 'record_sponsored_tap', 'hide_sponsored_partner', 'clear_hidden_sponsors']) {
      expect(mig).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
    }
  });
  it('price is $25 in one server-side table and a placement is exactly 7 days', () => {
    expect(mig).toMatch(/insert into public\.sponsored_price \(amount_cents\) values \(2500\)/);
    expect(mig).toMatch(/check \(ends_at = starts_at \+ interval '7 days'\)/);
  });
  it('inventory is 1 per area + category and 1 per business, enforced in the database', () => {
    expect(mig).toMatch(/exclude using gist \(\s*area_key with =, category_group with =, tstzrange\(starts_at, ends_at\) with &&/);
    expect(mig).toMatch(/create unique index if not exists sponsored_one_per_partner/);
  });
  it('the area key and category are derived from the business, not caller-supplied', () => {
    expect(mig).toMatch(/new\.area_key := sponsored_area_key/);
    expect(mig).toMatch(/new\.category_group := bp\.category/);
  });
});

describe('retention and no device-local cap', () => {
  it('the exposure table holds only user, business and one timestamp, is purged after 7 days, and cascades with the account', () => {
    const t = mig.slice(mig.indexOf('create table if not exists public.sponsored_seen'), mig.indexOf('create index if not exists sponsored_seen_seen_at'));
    expect(t).toMatch(/user_id uuid not null references public\.profiles\(id\) on delete cascade/);
    expect(t).toMatch(/partner_id uuid not null/);
    expect(t).toMatch(/seen_at timestamptz/);
    expect((t.match(/^\s+\w+ /gm) || []).length).toBeLessThanOrEqual(6);
    expect(mig).toMatch(/delete from sponsored_seen where seen_at < now\(\) - interval '7 days'/);
    expect(mig).toMatch(/cron\.schedule\('purge-sponsored-seen'/);
  });
  it('daily stats carry no user id or location', () => {
    const t = mig.slice(mig.indexOf('create table if not exists public.sponsored_daily_stats'), mig.indexOf('-- Cap enforcement ONLY'));
    expect(t).not.toMatch(/user_id|lat|lng|location/i);
  });
  it('the client has no device-local counter fallback', () => {
    for (const f of ['src/services/sponsored.js', 'src/components/SponsoredSpotlightSlot.js']) {
      expect(read(f)).not.toMatch(/AsyncStorage|localStorage|SecureStore/);
    }
  });
  it('the Settings switch is disclosed and the exposure record is not cleared by "Clear my activity history"', () => {
    const s = read('src/screens/SettingsScreen.js');
    expect(s).toContain('Show sponsored places');
    expect(s).toContain('Reset hidden sponsors');
    expect(s).toMatch(/7 days/);
  });
});

import fs from 'fs';
import path from 'path';
import { OFFERED_OCCASION_KEYS, OFFERED_OCCASION_OPTIONS, OCCASION_OPTIONS, occasionPhrase } from './businessAttributes';
import { scoreBusinessOpportunity } from '../services/businessOpportunityScoring';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

describe('Occasions we offer', () => {
  it('is exactly the six agreed occasions, all existing occasion keys (no invented "group events")', () => {
    expect(OFFERED_OCCASION_KEYS).toEqual(['birthday', 'anniversary', 'date_night', 'celebration', 'graduation', 'family_gathering']);
    OFFERED_OCCASION_KEYS.forEach((k) => expect(OCCASION_OPTIONS.map((o) => o.key)).toContain(k));
    expect(OFFERED_OCCASION_KEYS).not.toContain('group_events');
  });
  it('labels family_gathering Group/Family for businesses', () => {
    expect(OFFERED_OCCASION_OPTIONS.find((o) => o.key === 'family_gathering').label).toBe('Group/Family');
  });
  it('the client list equals the database CHECK and RPC list', () => {
    const mig = read('supabase/migrations/20270101_occasions_we_offer.sql');
    const lists = [...mig.matchAll(/array\[([^\]]*)\]::text\[\]/g)].map((m) => m[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, '')));
    const offered = lists.filter((l) => l.length === 6);
    expect(offered.length).toBe(2); // the CHECK and the RPC validation
    offered.forEach((l) => expect(l).toEqual(OFFERED_OCCASION_KEYS));
  });
  it('the fan-out ranks an offering business first and never invents a package', () => {
    const mig = read('supabase/migrations/20270101_occasions_we_offer.sql');
    expect(mig).toMatch(/v_req_occasion = any\(e\.offered_occasions\)\) desc,/);
    expect(mig).toMatch(/insert into business_request_offers \(request_id, partner_id\)/); // plain pending row only
  });
  it('is separate from want-more: its own column and RPC', () => {
    const mig = read('supabase/migrations/20270101_occasions_we_offer.sql');
    expect(mig).toMatch(/add column if not exists offered_occasions/);
    expect(mig).not.toMatch(/set priority_occasions/);
  });
});

describe('occasionPhrase', () => {
  it('uses the right article', () => {
    expect(occasionPhrase('anniversary')).toBe('an anniversary');
    expect(occasionPhrase('birthday')).toBe('a birthday');
    expect(occasionPhrase('date_night')).toBe('a date night');
  });
});

describe('scoring an offered occasion', () => {
  it('credits an offered occasion once, silent without one', () => {
    const r = scoreBusinessOpportunity({ requestOccasion: 'anniversary', businessOfferedOccasions: ['anniversary'] });
    expect(r.score).toBeGreaterThan(0);
    expect(r.reasons.some((x) => /You offer this occasion/.test(x.label))).toBe(true);
    expect(scoreBusinessOpportunity({ requestOccasion: 'anniversary', businessOfferedOccasions: [] }).score).toBe(0);
    expect(scoreBusinessOpportunity({ requestOccasion: null, businessOfferedOccasions: ['anniversary'] }).score).toBe(0);
  });
  it('does not stack on top of the stronger want-more credit', () => {
    const both = scoreBusinessOpportunity({ requestOccasion: 'anniversary', businessPriorityOccasions: ['anniversary'], businessOfferedOccasions: ['anniversary'] });
    const wantOnly = scoreBusinessOpportunity({ requestOccasion: 'anniversary', businessPriorityOccasions: ['anniversary'] });
    expect(both.score).toBe(wantOnly.score);
  });
});

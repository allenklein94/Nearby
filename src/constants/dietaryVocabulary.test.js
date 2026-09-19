const fs = require('fs');
const path = require('path');
const { DIETARY_OPTIONS, dietaryLabel } = require('./businessAttributes');

const mig = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261223_business_request_dietary.sql'), 'utf8');
const dbList = (re) => [...mig.match(re)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe('dietary vocabulary', () => {
  it('client list matches the DB CHECK, the RPC validation, exactly', () => {
    const keys = DIETARY_OPTIONS.map((o) => o.key).sort();
    expect(dbList(/check \(dietary <@ array\[([^\]]*)\]/).sort()).toEqual(keys);
    expect(dbList(/not dietary_param <@ array\[([^\]]*)\]/).sort()).toEqual(keys);
  });
  it('is a closed vocabulary with labels, no free text', () => {
    for (const o of DIETARY_OPTIONS) expect(dietaryLabel(o.key)).toBe(o.label);
    expect(DIETARY_OPTIONS.length).toBeLessThanOrEqual(8);
  });
  it('reaches a business only via the opportunity RPC, and never via the summary or pushes', () => {
    const summary = mig.split(/create or replace function/i).find((p) => /business_safe_request_summary/.test(p) && !/get_business_opportunities/.test(p));
    expect(summary ?? '').not.toMatch(/dietary/);
    expect(mig).toMatch(/'dietary', case when cardinality\(br\.dietary\) > 0/);
    expect(mig).not.toMatch(/'body',[^\n]*dietary/i);
  });
  it('the AI never fills it: assistants do not mention dietary', () => {
    for (const f of ['create-assistant', 'business-onboarding-assistant']) {
      expect(fs.readFileSync(path.join(__dirname, `../../supabase/functions/${f}/index.ts`), 'utf8')).not.toMatch(/dietary/i);
    }
  });
});

describe('dietary on gathering / match / community requests (20261225)', () => {
  const ext = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261225_dietary_all_request_types.sql'), 'utf8');
  it('the shared validator uses the same closed vocabulary as the CHECK', () => {
    const keys = DIETARY_OPTIONS.map((o) => o.key).sort();
    const list = [...ext.match(/not dietary_param <@ array\[([^\]]*)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(list).toEqual(keys);
  });
  it.each(['create_business_request_for_gathering', 'create_business_request_for_match', 'create_business_request_for_community'])('%s validates and stores dietary, and re-grants after the drop', (fn) => {
    const part = ext.split(/create or replace function/i).find((p) => new RegExp(`^\\s+public\\.${fn}\\(`, 'i').test(p));
    expect(part).toMatch(/dietary_param text\[\] DEFAULT NULL/);
    expect(part).toMatch(/public\.normalize_dietary\(dietary_param\)/);
    expect(ext).toMatch(new RegExp(`drop function if exists public\\.${fn}\\(`));
    expect(ext).toMatch(new RegExp(`grant execute on function public\\.${fn} to authenticated`));
  });
  it('the validator is not callable by clients', () => {
    expect(ext).toMatch(/revoke all on function public\.normalize_dietary\(text\[\]\) from public, anon, authenticated/);
  });
});

describe('every consumer entry point that creates a match business request offers the same picker', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  it('AskBusiness and DateProposal use the shared DietaryPicker and pass dietary through', () => {
    for (const f of ['../screens/AskBusinessScreen.js', '../screens/DateProposalScreen.js']) {
      const src = read(f);
      expect(src).toMatch(/<DietaryPicker /);
      expect(src).toMatch(/dietary: .*Foodie.*dietaryInput/);
    }
  });
  it('the accept flow only shows it for a Foodie plan with a chosen place, where a request is auto-created', () => {
    expect(read('../screens/DateProposalScreen.js')).toMatch(/proposal\.availability_id && proposal\.category === 'Foodie'/);
  });
  it('the picker offers exactly the closed vocabulary and no free-text input', () => {
    const src = read('../components/DietaryPicker.js');
    expect(src).toMatch(/DIETARY_OPTIONS\.map/);
    expect(src).not.toMatch(/TextInput/);
  });
});

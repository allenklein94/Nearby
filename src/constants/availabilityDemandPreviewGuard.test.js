// The "supply first" preview is a business-facing demand aggregate: it must go through the shared
// privacy floor in the data layer and stay count-only. DB behavior: scripts/live-verify/availability-demand-preview.js.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

describe('availability demand preview', () => {
  const mig = read('supabase/migrations/20261231_availability_demand_preview.sql');
  const fn = mig.slice(mig.indexOf('create or replace function public.get_availability_demand_preview'), mig.indexOf('revoke all on function public.get_availability_demand_preview'));
  it('counts distinct people and applies demand_min_people()', () => {
    expect(fn).toMatch(/count\(distinct br\.requester_id\)/);
    expect(fn).toMatch(/v_people >= demand_min_people\(\)/);
  });
  it('is owner-only and returns no ids or text', () => {
    expect(fn).toMatch(/You do not manage a business/);
    expect(fn).not.toMatch(/raw_text|jsonb_agg|array_agg/);
  });
  it('is not callable anonymously', () => {
    expect(mig).toMatch(/revoke all on function public\.get_availability_demand_preview\([^)]*\) from public, anon/);
  });
  it('the edge function forwards a scheduled window and the service exposes the preview', () => {
    expect(read('supabase/functions/screen-business-content/index.ts')).toMatch(/scheduled\.startsAt/);
    expect(read('src/services/businessFulfillment.js')).toMatch(/export async function getAvailabilityDemandPreview/);
  });
});

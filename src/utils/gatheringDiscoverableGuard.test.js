const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const mig = read('../../supabase/migrations/20270171_gathering_discoverable.sql');
const svc = read('../services/gatherings.js');
const create = read('../screens/CreateGatheringScreen.js');
const edit = read('../screens/EditGatheringScreen.js');

jest.mock('../services/supabase', () => ({ supabase: {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }));
jest.mock('expo-location', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../services/friends', () => ({ getMyFriends: jest.fn() }));
jest.mock('../services/communities', () => ({ getMyCommunities: jest.fn() }));
jest.mock('../services/userLocation', () => ({ getUserLocation: jest.fn(), requireUserLocation: jest.fn() }));

describe('discoverable vs joinable (item 74)', () => {
  it('the column defaults to true and Link only requires Everyone visibility', () => {
    expect(mig).toMatch(/discoverable boolean not null default true/);
    expect(mig).toMatch(/check \(discoverable or visibility = 'everyone'\)/);
  });

  it('every server discovery and aggregate path checks discoverable', () => {
    for (const fn of ['get_bounded_nearby_gathering_ids', 'get_trending_gathering_ids', 'get_partner_demand_signals', 'notify_gathering_interest_threshold', 'notify_matching_things_to_do']) {
      const start = mig.indexOf(`public.${fn}(`);
      expect(start).toBeGreaterThan(-1);
      const end = mig.indexOf('$function$;', start);
      expect(mig.slice(start, end)).toMatch(/discoverable/);
    }
  });

  it('join rules are not touched by the migration (approval, capacity, blocks stay in join_gathering)', () => {
    expect(mig).not.toMatch(/join_gathering/);
  });

  it('the feed filter drops a link-only gathering and keeps everything else', () => {
    const { applyGatheringVisibilityFilters } = require('../services/gatherings');
    const ctx = { excludedHostIds: new Set(), isWoman: true, friendIds: new Set(), communityIds: new Set() };
    const rows = [
      { id: 'a', host_id: 'h', visibility: 'everyone', discoverable: true },
      { id: 'b', host_id: 'h', visibility: 'everyone', discoverable: false },
      { id: 'c', host_id: 'h', visibility: 'everyone' }, // row from before the column: still listed
    ];
    expect(applyGatheringVisibilityFilters(rows, ctx).map((g) => g.id)).toEqual(['a', 'c']);
  });

  it('Home, Discover, search and the intent resolver all read the one filtered pipeline', () => {
    expect(svc).toMatch(/applyGatheringVisibilityFilters\(data \?\? \[\], context\)/);
    expect(svc).toMatch(/applyGatheringVisibilityFilters\(\[\.\.\.byId\.values\(\)\], context\)/);
    expect(read('../services/intentResolver.js')).toMatch(/getNearbyGatherings/);
    expect(read('../services/homeDashboard.js')).toMatch(/\.eq\('discoverable', true\)/);
    expect(read('../services/brandOffers.js')).toMatch(/\.eq\('discoverable', true\)/);
  });

  it('a link-only gathering can still be opened by id (no discoverable filter in getGatheringById)', () => {
    const i = svc.indexOf('export async function getGatheringById');
    expect(i).toBeGreaterThan(-1);
    expect(svc.slice(i, i + 1500)).not.toMatch(/discoverable/);
  });

  it('create sends it only for Everyone; the choice appears only for Everyone', () => {
    expect(svc).toMatch(/discoverable: visibility === 'everyone' \? discoverable !== false : true/);
    expect(create).toMatch(/How can people find it\?/);
    expect(create).toMatch(/visibility === 'everyone' && \(\s*<>\s*<Text[^>]*>How can people find it\?/);
    expect(create).toMatch(/Who can join it\?/);
    expect(create).toMatch(/Link only/);
  });

  it('edit exposes it only for an Everyone gathering', () => {
    expect(edit).toMatch(/canBeLinkOnly/);
    expect(edit).toMatch(/\.\.\.\(canBeLinkOnly \? \{ discoverable \} : \{\}\)/);
  });
});

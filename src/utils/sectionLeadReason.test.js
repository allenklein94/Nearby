// Item 194 refined (owner, 2026-10-04): at most 2 reasons per card; the section's own reason leads when the card carries
// it; the second slot is the next strongest INDEPENDENT reason; a gathering still appears once per surface (items 52/91).
import fs from 'fs';
import path from 'path';
import { strongestReasons, reasonTier, MAX_SHOWN_REASONS } from '../constants/signalPriority';
import { becauseYouLikeReason, reasonText } from '../constants/recommendationReasonVocabulary';
import { friendsInterestReason } from './friendInterests';
import { sectionLeadReason, buildDiscoverSections } from './discoverSections';
import { gatheringCardModel } from './recommendationCard';

const going = 'Sam is going';
const because = becauseYouLikeReason('Coffee');
const attending = reasonText('attendingCount', { count: 12 });
const friendsInto = friendsInterestReason('Coffee', { friend_count: 1, names: ['Alex'] });

describe('strongestReasons with a section lead', () => {
  it('without a lead: unchanged, strongest first, max 2', () => {
    expect(MAX_SHOWN_REASONS).toBe(2);
    expect(strongestReasons([attending, because, going])).toEqual([going, because]);
  });

  it('the section reason leads even when weaker; the second slot is the strongest other one', () => {
    expect(strongestReasons([attending, because, going], undefined, { lead: attending })).toEqual([attending, going]);
    expect(strongestReasons([attending, because, going], undefined, { lead: because })).toEqual([because, going]);
  });

  it('the second slot is independent: never the same tier as the lead', () => {
    const trendingToo = 'Trending nearby';
    expect(reasonTier(trendingToo)).toBe(reasonTier(attending));
    expect(strongestReasons([attending, trendingToo], undefined, { lead: attending })).toEqual([attending]);
  });

  it('a lead the card does not carry is ignored (never invented)', () => {
    expect(strongestReasons([because, going], undefined, { lead: attending })).toEqual([going, because]);
  });
});

describe('sectionLeadReason', () => {
  const g = { id: 'g1', interest_tag: 'Coffee', approvedCount: 12 };
  it('each reason-section names its own reason, built like the card reasons', () => {
    expect(sectionLeadReason('because', g)).toBe(because);
    expect(sectionLeadReason('trending', g)).toBe(attending);
    expect(sectionLeadReason('friends', g, { friendInterestByTag: { Coffee: { friend_count: 1, names: ['Alex'] } } })).toBe(friendsInto);
  });
  it('timing sections have none (the when line carries them); below the trending floor = none', () => {
    for (const k of ['now', 'tonight', 'weekend', null]) expect(sectionLeadReason(k, g)).toBeNull();
    expect(sectionLeadReason('trending', { ...g, approvedCount: 2 })).toBeNull();
  });
});

describe('card model', () => {
  const g = { id: 'g1', title: 'Coffee meetup', interest_tag: 'Coffee', scheduled_at: new Date(Date.now() + 864e5).toISOString() };
  const signals = [because, attending, going].map((text) => ({ kind: 'reason', text }));
  it('the lead shows first and only 2 reasons are shown', () => {
    const card = gatheringCardModel(g, { signals, leadReason: attending });
    expect(card.reasons).toEqual([attending, going]);
    expect(gatheringCardModel(g, { signals }).reasons).toEqual([going, because]);
  });
});

describe('once per surface still holds', () => {
  it('a gathering that qualifies for several sections is placed once', () => {
    const g = { id: 'g1', interest_tag: 'Coffee', approvedCount: 12, scheduled_at: new Date(Date.now() + 5 * 864e5).toISOString() };
    const sections = buildDiscoverSections({ gatherings: [g], declared: ['Coffee'], friendInterestByTag: { Coffee: { friend_count: 2 } } });
    expect(sections.flatMap((s) => s.items).filter((x) => x.id === 'g1')).toHaveLength(1);
  });
  it('Discover passes each section key to its cards', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');
    expect(src).toMatch(/section\.items\.map\(\(g, i\) => renderGatheringTile\(g, i, section\.key\)\)/);
    expect(src).toMatch(/sectionLeadReason\(sectionKey, g, \{ friendInterestByTag \}\)/);
    expect(src).not.toMatch(/\.map\(renderGatheringTile\)/);
  });
});

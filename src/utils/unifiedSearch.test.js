import { searchTopic, matchBusinesses, friendsLineForTopic, BUSINESS_RESULT_CAP } from './unifiedSearch';

const biz = (id, over = {}) => ({ id, name: `Biz ${id}`, category: 'food_drink', subcategory: null, categories: [], cuisine: null, distanceMiles: 1, ...over });
const read = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');

describe('one search across everything (item 92)', () => {
  it('resolves the topic through the canonical resolver, never guessing', () => {
    expect(searchTopic('coffee')).toMatchObject({ kind: 'tag', label: 'Coffee' });
    expect(searchTopic('cafe')).toMatchObject({ kind: 'tag', label: 'Coffee' });
    expect(searchTopic('italian')).toMatchObject({ kind: 'cuisine', cuisine: 'italian' });
    expect(searchTopic('food & drink')).toMatchObject({ kind: 'group', label: 'Food & Drink' });
    expect(searchTopic('zzqx')).toBeNull();
  });
  it('businesses match by name or a DECLARED type/cuisine only', () => {
    const topic = searchTopic('coffee');
    const list = [
      biz('name', { name: 'Coastal Coffee', subcategory: 'Bars & Lounges' }),
      biz('declared', { subcategory: 'Coffee', distanceMiles: 3 }),
      biz('other', { subcategory: 'Bars & Lounges' }),
      biz('majorOnly'), // declared no type: serves its whole major (business_served_tags rule)
      biz('wrongMajor', { category: 'auto_transportation' }),
    ];
    const ids = matchBusinesses(list, 'coffee', topic).map((b) => b.id);
    expect(ids).toEqual(['name', 'majorOnly', 'declared']);
    expect(matchBusinesses([biz('i', { cuisine: 'italian' }), biz('m', { cuisine: 'mexican' })], 'italian').map((b) => b.id)).toEqual(['i']);
  });
  it('a business name match leads, then distance; capped', () => {
    const many = Array.from({ length: 9 }, (_, i) => biz(`b${i}`, { subcategory: 'Coffee', distanceMiles: 9 - i }));
    const out = matchBusinesses([...many, biz('n', { name: 'Coffee Corner', distanceMiles: 20 })], 'coffee');
    expect(out).toHaveLength(BUSINESS_RESULT_CAP);
    expect(out[0].id).toBe('n');
    expect(out[1].distanceMiles).toBeLessThan(out[2].distanceMiles);
  });
  it('no topic and no name hit = no business; too-short text = nothing', () => {
    expect(matchBusinesses([biz('x')], 'zzqx')).toEqual([]);
    expect(matchBusinesses([biz('x', { name: 'C' })], 'c')).toEqual([]);
  });
  it('friends line: accepted friends only, via the shared wording', () => {
    const topic = searchTopic('coffee');
    expect(friendsLineForTopic(topic, { Coffee: { friend_count: 2, sample_names: ['Sam', 'Alex'] } })).toBe('Sam and Alex are into Coffee');
    expect(friendsLineForTopic(topic, { Coffee: { friend_count: 0 } })).toBeNull();
    expect(friendsLineForTopic(null, { Coffee: { friend_count: 3 } })).toBeNull();
  });
  it('Discover wires it without stranger discovery or a new screen', () => {
    const d = read('screens/DiscoverHubScreen.js');
    expect(d).toMatch(/searchTopic\(query\.literalTerm\)/);
    expect(d).toMatch(/matchBusinesses\(businesses, query\.literalTerm/);
    expect(d).toMatch(/getFriendsInterestedIn\(searchTopicTagKey/);
    expect(d).toMatch(/applyOpenNow\(matchBusinesses\(/); // Open now still applies
    expect(d).toMatch(/&& searchedBusinesses\.length === 0;/); // a business hit is not "nothing matched"
    const u = read('utils/unifiedSearch.js');
    expect(u).not.toMatch(/supabase|getNearbyMatches|getFriendDiscoveryCandidates|profiles/);
  });
  it('nearby businesses carry their declared type so search can match it', () => {
    expect(read('services/brandOffers.js')).toMatch(/booking_mode, category, subcategory, categories, cuisine'\)/);
  });
});

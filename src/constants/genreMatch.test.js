import fs from 'fs';
import path from 'path';
import { genresFromText, genreFit, applyGenreToCandidates, genreReason, GENRE_KEYS, GENRE_FIT_POINTS } from './genreMatch';
import { GENRE_OPTIONS } from '../utils/gatheringPractical';
import { CATEGORY_GROUPS } from './gatheringCategories';
import { resolveAsk } from '../utils/askResolver';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const g = (id, genre, extra = {}) => ({ id, kind: 'gathering', category: 'Live Music', score: 5, subtitle: 'Tonight', genre, ...extra });

describe('typed genre words (deterministic, the person\'s own words)', () => {
  it.each([
    ['rock show tonight', ['rock']],
    ['jazz tonight', ['jazz']],
    ['techno night', ['techno']],
    ['techno', ['techno']],
    ['techno music this weekend', ['techno']],
    ['some deep house music', ['electronic']],
    ['house music tonight', ['electronic']],
    ['an EDM show', ['electronic']],
    ['rap show tonight', ['hip_hop']],
    ['salsa night', ['latin']],
    ['reggaeton tonight', ['latin']],
    ['rock music', ['rock']],
    ['jazz music', ['jazz']],
    ['a punk rock gig', ['rock']],
    ['hip hop show this weekend', ['hip_hop']],
    ['country music tonight', ['country']],
    ['open mic night', ['open_mic']],
    ['rhythm and blues', ['r_and_b']],
    ['k-pop concert', ['pop']],
  ])('%s -> %j', (text, keys) => expect(genresFromText(text)).toEqual(keys));

  it.each([
    'concert tonight', 'live music tonight', 'something fun tonight', 'rock climbing tomorrow', 'indoor rock wall',
    'a pop-up market', 'drive out to the country', 'dinner at my house', 'house party', 'latin class', 'folks from work', '',
    'house tonight', 'open house', 'house of cards',
  ])('%s names no genre', (text) => expect(genresFromText(text)).toEqual([]));

  it('only closed-list genre keys come out', () => {
    for (const t of ['rock jazz blues folk classical techno r&b open mic hip hop k-pop country music latin night']) {
      for (const k of genresFromText(t)) expect(GENRE_KEYS).toContain(k);
    }
  });

  it('resolveAsk carries it, and a generic concert ask carries none', () => {
    expect(resolveAsk('rock show tonight', null).genres).toEqual(['rock']);
    expect(resolveAsk('concert tonight', null).genres).toEqual([]);
  });
});

describe('ranking: declared genre only, lift only, nothing removed', () => {
  const list = [g('a', 'jazz'), g('b', 'rock'), g('c', null), g('d', 'electronic'), g('e', 'techno')];

  it('Rock / Jazz / Techno / Electronic asks lift ONLY the matching declared gathering, by the same weak amount', () => {
    for (const [text, id] of [['rock show tonight', 'b'], ['jazz tonight', 'a'], ['techno night', 'e'], ['house music tonight', 'd']]) {
      const out = applyGenreToCandidates(list, genresFromText(text));
      expect(out.find((c) => c.id === id).score).toBe(5 + GENRE_FIT_POINTS);
      for (const c of out.filter((x) => x.id !== id)) expect(c.score).toBe(5);
    }
  });

  it('a mismatch or undeclared genre is neutral and never removed', () => {
    const out = applyGenreToCandidates(list, ['rock']);
    expect(out).toHaveLength(list.length);
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // an Electronic gathering is not lifted by a Techno ask, and vice versa (no silent collapse)
    expect(genreFit(g('x', 'electronic'), ['techno']).delta).toBe(0);
    expect(genreFit(g('x', 'techno'), ['electronic']).delta).toBe(0);
    expect(genreFit(g('x', 'jazz'), ['rock'])).toEqual({ delta: 0, reason: null });
    expect(genreFit(g('x', null), ['rock'])).toEqual({ delta: 0, reason: null });
  });

  it('a generic ask changes nothing (same array back)', () => {
    expect(applyGenreToCandidates(list, genresFromText('concert tonight'))).toBe(list);
  });

  it('never inferred from title, description, tag or venue', () => {
    const c = { id: 'z', category: 'Live Music', title: 'Rock Night at the Jazz Club', description: 'techno and blues', genre: null, score: 1 };
    expect(genreFit(c, ['rock', 'jazz', 'electronic', 'blues']).delta).toBe(0);
    expect(read('src/constants/genreMatch.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/\.(title|description|category|venue|area)\b/);
  });

  it('an undeclared value outside the closed list never matches', () => {
    expect(genreFit(g('x', 'polka'), ['polka']).delta).toBe(0);
  });
  it('Techno is a host-selectable genre, and the DB CHECK accepts it with every older genre', () => {
    expect(GENRE_OPTIONS.find((o) => o.key === 'techno')?.label).toBe('Techno');
    const sql = read('supabase/migrations/20270215_gathering_genre_techno.sql');
    const db = [...sql.match(/genre in \(([^)]*)\)/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const old = [...read('supabase/migrations/20270195_gathering_genre.sql').match(/genre in \(([^)]*)\)/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const k of old) expect(db).toContain(k);
    expect(db).toContain('techno');
    expect(genreReason('techno')).toBe('Related to your interest in Techno');
  });
  it('Create and Edit render the host choices from the one list', () => {
    for (const f of ['src/screens/CreateGatheringScreen.js', 'src/screens/EditGatheringScreen.js']) expect(read(f)).toMatch(/GENRE_OPTIONS\.map/);
  });
});

describe('explanation', () => {
  it('reads "Related to your interest in Rock", never a claimed preference', () => {
    const [out] = applyGenreToCandidates([g('b', 'rock')], ['rock']);
    expect(out.subtitle).toBe('Related to your interest in Rock');
    for (const k of GENRE_KEYS) expect(genreReason(k)).not.toMatch(/you like|because you/i);
    expect(read('src/constants/genreMatch.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/you like|because you/i);
  });
  it('keeps the Full / waitlist line when the gathering is full', () => {
    const [out] = applyGenreToCandidates([g('b', 'rock', { isFull: true, subtitle: '🔒 Full — Join Waitlist' })], ['rock']);
    expect(out.subtitle).toBe('🔒 Full — Join Waitlist');
    expect(out.score).toBe(5 + GENRE_FIT_POINTS);
  });
});

describe('scope and taxonomy guards', () => {
  const tags = CATEGORY_GROUPS.flatMap((x) => x.tags).map((t) => t.toLowerCase());
  const labels = GENRE_OPTIONS.filter((o) => o.key).map((o) => o.label.toLowerCase());

  it('no genre is a category, and no genre + activity category exists', () => {
    expect(labels).toContain('techno');
    for (const l of [...labels, 'edm', 'house']) {
      expect(tags).not.toContain(l);
      expect(tags.some((t) => t.startsWith(`${l} `) || t.endsWith(` ${l}`))).toBe(false);
    }
  });

  it('typed-ask only: not in Home / Discover / Gatherings feeds, not in people discovery', () => {
    for (const f of ['src/screens/HomeScreen.js', 'src/screens/DiscoverHubScreen.js', 'src/screens/GatheringsScreen.js',
      'src/services/homeDashboard.js', 'src/utils/datingCardReasons.js', 'src/services/friendDiscovery.js']) {
      if (fs.existsSync(path.join(ROOT, f))) expect([f, /genreMatch|genresFromText/.test(read(f))]).toEqual([f, false]);
    }
    const users = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
      .filter((f) => /\.js$/.test(f) && !/test\.js$/.test(f) && read(`src/${f}`).includes('genreMatch'));
    expect(users.sort()).toEqual(['services/intentResolver.js', 'utils/askResolver.js'].map((x) => x.replace('/', path.sep)).sort());
  });

  it('no business payload, request, demand signal or AI detection carries genre', () => {
    const migs = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).sort();
    const last = migs.filter((m) => /function\s+public\.get_business_opportunities\b/i.test(read(`supabase/migrations/${m}`))).pop();
    expect(read(`supabase/migrations/${last}`)).not.toMatch(/\bgenre\b/);
    const demand = migs.filter((m) => /function\s+public\.get_partner_demand_signals\b/i.test(read(`supabase/migrations/${m}`))).pop();
    expect(read(`supabase/migrations/${demand}`)).not.toMatch(/\bgenre\b/);
    for (const m of migs) expect([m, /alter table public\.(business_\w+|brand_\w+)[^;]*\bgenre\b/i.test(read(`supabase/migrations/${m}`))]).toEqual([m, false]);
    expect(read('src/constants/genreMatch.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/fetch\(|supabase|functions\.invoke|anthropic/i);
  });
});

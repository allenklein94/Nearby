const fs = require('fs');
const path = require('path');
const { ACTIVITY_FORMATS, ACTIVITY_FORMAT_KEYS, FORMAT_OPTIONS, TAG_FORMAT, formatOf, formatsFromText, applyFormatToCandidates } = require('./activityFormat');
const { CATEGORY_GROUPS } = require('./gatheringCategories');
const { commitmentOf } = require('./commitmentLevel');
const { practicalFacts } = require('../utils/gatheringPractical');
const { resolveAsk } = require('../utils/askResolver');

const ALL_TAGS = new Set(CATEGORY_GROUPS.flatMap((g) => g.tags));
const ROOT = path.join(__dirname, '../..');

describe('activity format vocabulary (item 66)', () => {
  it('is the owner\'s 16 formats, one list, matching the database CHECK', () => {
    expect(ACTIVITY_FORMAT_KEYS).toEqual(['drop_in', 'class', 'tournament', 'meetup', 'concert', 'show', 'festival', 'tour', 'workshop', 'appointment', 'reservation', 'open_play', 'competition', 'exhibition', 'market', 'party']);
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270205_gathering_activity_format.sql'), 'utf8');
    const inSql = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(inSql)].sort()).toEqual([...ACTIVITY_FORMAT_KEYS].sort());
    expect(FORMAT_OPTIONS[0]).toEqual({ key: null, label: 'Not specified' });
  });
  it('format is not a category: no format key or label is a category tag, and tag-named formats point at real tags', () => {
    for (const f of ACTIVITY_FORMATS) expect(ALL_TAGS.has(f.label) ? `${f.label} is a tag` : f.label).toBe(f.label);
    for (const [tag, f] of Object.entries(TAG_FORMAT)) {
      expect(ALL_TAGS.has(tag) ? tag : `unknown tag ${tag}`).toBe(tag);
      expect(ACTIVITY_FORMAT_KEYS).toContain(f);
    }
    expect(TAG_FORMAT.Pickleball).toBeUndefined();
  });
});

describe('recognition from the person\'s words', () => {
  it('the owner\'s example: same category, different format', () => {
    const t = resolveAsk('a pickleball tournament this weekend');
    const o = resolveAsk('pickleball open play tonight');
    expect(t.formats).toEqual(['tournament']);
    expect(o.formats).toEqual(['open_play']);
    expect(t.subcategory).toBe('Pickleball');
    expect(o.subcategory).toBe('Pickleball');
  });
  it('common phrasings, and the traps', () => {
    expect(formatsFromText('a cooking class')).toEqual(['class']);
    expect(formatsFromText('drop-in yoga')).toEqual(['drop_in']);
    expect(formatsFromText('a comedy show tonight')).toEqual(['show']);
    expect(formatsFromText('show me something fun')).toEqual([]);
    expect(formatsFromText('dinner for a party of 6')).toEqual([]);
    expect(formatsFromText('a birthday party')).toEqual(['party']);
    expect(formatsFromText('pickup games of basketball')).toEqual(['open_play']);
    expect(formatsFromText('coffee')).toEqual([]);
  });
});

describe('a result\'s format comes from real data only', () => {
  it('declared first, else a tag that names a format, else none', () => {
    expect(formatOf({ format: 'tournament', category: 'Pickleball' })).toBe('tournament');
    expect(formatOf({ category: 'Concerts' })).toBe('concert');
    expect(formatOf({ category: 'Pickleball' })).toBeNull();
    expect(formatOf({ format: 'rave' })).toBeNull();
  });
  it('ranks only: a fit lifts, a known different format sinks a little, unknown untouched, nothing removed', () => {
    const cands = [
      { id: 't', category: 'Pickleball', format: 'tournament', score: 0 },
      { id: 'o', category: 'Pickleball', format: 'open_play', score: 0 },
      { id: 'u', category: 'Pickleball', score: 0 },
    ];
    const out = applyFormatToCandidates(cands, ['tournament']);
    expect(out.map((c) => c.id)).toEqual(['t', 'o', 'u']);
    expect(out.map((c) => c.score)).toEqual([2, -1, 0]);
    expect(out[0].subtitle).toBe('🏆 Tournament');
    expect(applyFormatToCandidates(cands, [])).toBe(cands);
  });
  it('a declared format feeds commitment (open play is a drop-in, a tournament a planned event)', () => {
    expect(commitmentOf({ category: 'Pickleball', format: 'open_play' })).toBe('drop_in');
    expect(commitmentOf({ category: 'Pickleball', format: 'tournament' })).toBe('planned_event');
    expect(commitmentOf({ format: 'open_play', durationMinutes: 600 })).toBe('all_day');
    expect(commitmentOf({ category: 'Pickleball' })).toBeNull();
  });
  it('shown on the card/detail only when the host declared it', () => {
    expect(practicalFacts({ format: 'open_play' })[0]).toBe('🏓 Open play');
    expect(practicalFacts({ interest_tag: 'Concerts' })).toEqual([]);
  });
});

describe('wiring', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  it('stored and edited through the one gathering service, offered in Create and Edit', () => {
    expect(read('src/services/gatherings.js')).toMatch(/genre, format, (skill_level, )?(effort_level, )?features/);
    for (const f of ['src/screens/CreateGatheringScreen.js', 'src/screens/EditGatheringScreen.js']) {
      expect(read(f)).toContain('How does it run?');
      expect(read(f)).toContain('FORMAT_OPTIONS.map');
    }
  });
  it('the resolver carries the gathering\'s format and applies the ask\'s', () => {
    const src = read('src/services/intentResolver.js');
    expect(src).toContain('format: gathering.format ?? null');
    expect(src).toContain('applyFormatToCandidates(deduped, formatsFromText(rawText))');
  });
  it('never uses AI or the network', () => {
    const src = read('src/constants/activityFormat.js').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/fetch\(|supabase|functions\.invoke|anthropic/i);
  });
});

describe('item 66 decision (LOCKED 2026-09-25): format is a structured gathering attribute, not a discovery system', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const { commitmentAsk, applyCommitmentToCandidates } = require('./commitmentLevel');
  it('the owner\'s positive examples', () => {
    expect(formatsFromText('pickleball tournament')).toEqual(['tournament']);
    expect(formatsFromText('open play')).toEqual(['open_play']);
    expect(formatsFromText('drop-in yoga')).toEqual(['drop_in']);
    expect(formatsFromText('cooking class')).toEqual(['class']);
    expect(formatsFromText('comedy show')).toEqual(['show']);
  });
  it('negative guards: vague words never create a format', () => {
    for (const t of ['something fun tonight', 'party of 6', 'dinner for a party of 4', 'show me what is nearby', 'something to do', 'hang out with friends', 'go out tonight', 'coffee', 'a fun night', 'what should we do this weekend']) {
      expect([t, formatsFromText(t)]).toEqual([t, []]);
      expect([t, resolveAsk(t).formats]).toEqual([t, []]);
    }
  });
  it('explicit host format wins; unknown stays unknown and keeps its rank', () => {
    const cands = [{ id: 'u', score: 5 }, { id: 'c', format: 'open_play', score: 5 }];
    const out = applyFormatToCandidates(cands, ['tournament']);
    expect(out.find((c) => c.id === 'u')).toBe(cands[0]);
    expect(out.find((c) => c.id === 'c').score).toBe(4);
    expect(out).toHaveLength(2);
  });
  it('"nothing too committal" prefers open play over a tournament through the existing commitment model', () => {
    const ask = commitmentAsk('nothing too committal tonight, I don\'t want to commit');
    expect(ask).toBe('light');
    const out = applyCommitmentToCandidates([
      { id: 'tour', category: 'Pickleball', format: 'tournament', score: 0 },
      { id: 'open', category: 'Pickleball', format: 'open_play', score: 0 },
    ], ask);
    expect(out.find((c) => c.id === 'open').score).toBeGreaterThan(out.find((c) => c.id === 'tour').score);
    expect(out).toHaveLength(2);
  });
  it('category -> format only for categories that ARE a format (closed, reviewed list; extend deliberately)', () => {
    expect(TAG_FORMAT).toEqual({
      Concerts: 'concert', Festivals: 'festival', Workshops: 'workshop', Exhibits: 'exhibition',
      Classes: 'class', 'Art Classes': 'class', 'Cooking Class': 'class', 'Dance Classes': 'class', 'Language Classes': 'class', 'Technology Classes': 'class',
      'Farmers Markets': 'market', Markets: 'market', 'Tech Meetup': 'meetup', 'Boat Tours': 'tour',
    });
  });
  it('no format filter on Discover or Gatherings, no business format field, nothing in business payloads, no AI detection', () => {
    for (const f of ['src/screens/DiscoverHubScreen.js', 'src/screens/GatheringsScreen.js']) expect([f, /activityFormat|FORMAT_OPTIONS|\.format\s*===|formatOf\(/.test(read(f))]).toEqual([f, false]);
    const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((m) => m > '20270205');
    for (const m of ['20270205_gathering_activity_format.sql', ...migrations]) {
      const sql = read(`supabase/migrations/${m}`);
      expect([m, /alter table public\.(business_\w+|brand_\w+)\s+add column[^;]*\bformat\b/i.test(sql)]).toEqual([m, false]);
      expect([m, /get_business_opportunities[\s\S]*\bformat\b/i.test(sql)]).toEqual([m, false]);
    }
    const fnDir = path.join(ROOT, 'supabase/functions');
    for (const d of fs.readdirSync(fnDir)) {
      const idx = path.join(fnDir, d, 'index.ts');
      if (fs.existsSync(idx)) expect([d, /open_play|activity format|ACTIVITY_FORMATS/i.test(fs.readFileSync(idx, 'utf8'))]).toEqual([d, false]);
    }
  });
  it('optional: Create defaults to Not specified and the service sends NULL when unset', () => {
    expect(read('src/screens/CreateGatheringScreen.js')).toContain('const [format, setFormat] = useState(null);');
    expect(read('src/services/gatherings.js')).toContain('format: format ?? null,');
  });
});

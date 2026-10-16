// Owner item 122 (2026-10-16, LOCKED): a completed gathering can leave a memory -- "Beach Volleyball · Completed" plus the
// photos the people who were there chose to add, seen ONLY by them, and never a social feed. Journey: gatheringMemory.
import fs from 'fs';
import path from 'path';
import { gatheringMemoryState, isGatheringOver, memoryCountFor } from './gatheringCompletion';

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const code = (f) => read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const now = new Date(2026, 9, 16, 20, 0);
const minsAgo = (m) => new Date(now.getTime() - m * 60000).toISOString();
const over = { scheduled_at: minsAgo(180), duration_minutes: 120 };
const going = { scheduled_at: minsAgo(60), duration_minutes: 120 };

const srcFiles = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = path.join(dir, e.name);
  if (e.isDirectory()) return srcFiles(rel);
  return /\.js$/.test(e.name) && !/\.test\.js$|\.journey\.js$/.test(e.name) ? [rel] : [];
});
const ALL = srcFiles('src');

describe('one rule: Completed + Memories only for the people who were there, only once it is over', () => {
  test('host and approved attendee of an over gathering', () => {
    expect(gatheringMemoryState({ ...over, isHost: true }, now)).toEqual({ completed: true, showMemories: true });
    expect(gatheringMemoryState({ ...over, myStatus: 'approved' }, now)).toEqual({ completed: true, showMemories: true });
  });
  test('never while it is still going, and never for anyone who was not there', () => {
    expect(gatheringMemoryState({ ...going, isHost: true }, now).completed).toBe(false);
    for (const myStatus of ['pending', 'waitlisted', 'declined', null]) {
      expect(gatheringMemoryState({ ...over, myStatus }, now)).toEqual({ completed: false, showMemories: false });
    }
    expect(gatheringMemoryState({ ...over, myInterested: true }, now).showMemories).toBe(false);
    expect(gatheringMemoryState(null, now)).toEqual({ completed: false, showMemories: false });
  });
  test('"over" is item 34\'s engine, not a second definition', () => {
    expect(code('src/utils/gatheringCompletion.js')).toMatch(/const completed = wasThere && isGatheringOver\(gathering, now\)/);
    expect(isGatheringOver(going, now)).toBe(false);
  });
});

describe('the screens read that rule', () => {
  test('GatheringDetail: the title gets " · Completed" and Memories mounts only from gatheringMemoryState', () => {
    const d = code('src/screens/GatheringDetailScreen.js');
    expect(d).toMatch(/const memoryState = gatheringMemoryState\(gathering\)/);
    expect(d).toMatch(/memoryState\.completed \? <Text style=\{styles\.titleCompleted\}>\{` · \$\{PLAN_STATUS_META\[PLAN_STATUS\.COMPLETED\]\.label\}`\}/);
    expect(d).toMatch(/\{memoryState\.showMemories && <GatheringMemories gatheringId=\{gatheringId\} openOnLoad=\{route\.params\?\.openMemories === true\} \/>\}/);
  });
  test('Plans -> Past: Completed only once really over (a started gathering stays Confirmed)', () => {
    const p = code('src/screens/PlansScreen.js');
    expect(p).toMatch(/resolveGatheringPlanStatus\(\{ \.\.\.legacy, isPast: legacy\.isPast && isGatheringOver\(g\) \}\)/);
    // the hosting rows carry the host's duration, so the rule can be applied to them
    expect(read('src/services/gatherings.js')).toMatch(/select\('id, title, description, interest_tag, scheduled_at, duration_minutes, show_on_map, hosting_partner_id, energy_level,/);
  });
});

describe('not a social feed (LOCKED)', () => {
  test('memories are read in one place and shown on one screen', () => {
    expect(ALL.filter((f) => /getGatheringMemories\(/.test(code(f))).sort()).toEqual(['src/components/GatheringMemories.js', 'src/services/stories.js']);
    expect(ALL.filter((f) => /import GatheringMemories from/.test(read(f)))).toEqual(['src/screens/GatheringDetailScreen.js']);
  });
  test('Discover\'s Happening Nearby holds business moments only; story rings never carry a memory', () => {
    const d = code('src/screens/DiscoverHubScreen.js');
    expect(d).not.toMatch(/gatheringStories|getGatheringStoriesGrouped/);
    expect(read('src/services/stories.js')).not.toMatch(/getGatheringStoriesGrouped/);
    const s = code('src/services/stories.js');
    for (const fn of ['getVisibleStoriesGrouped', 'getStoryPresenceForUsers']) {
      const body = s.slice(s.indexOf(`export async function ${fn}`), s.indexOf('export async function', s.indexOf(`export async function ${fn}`) + 10));
      expect(body).toMatch(/\.is\('gathering_id', null\)/);
    }
  });
  test('no likes, comments, pushes, motion or Home row in the memories section', () => {
    const c = code('src/components/GatheringMemories.js');
    expect(c).not.toMatch(/like|comment|_send_push|Animated|motion\/|SEQUENCES|shouldPlay=\{true\}|isLooping/i);
    expect(code('src/screens/HomeScreen.js')).not.toMatch(/GatheringMemories|getGatheringMemories/);
  });
});

describe('the server decides who sees a memory (migration 20270315)', () => {
  const m = read('supabase/migrations/20270315_gathering_memories_attendees_only.sql');
  test('one rule: host or approved attendee', () => {
    expect(m).toMatch(/create or replace function public\.viewer_was_at_gathering\(p_gathering uuid\)/);
    expect(m).toMatch(/gi\.status = 'approved'/);
    expect(m).toMatch(/revoke all on function public\.viewer_was_at_gathering\(uuid\) from public, anon;/);
  });
  test('a gathering-linked story: only the poster and the people who were there; friends/matches only for ordinary unexpired stories', () => {
    expect(m).toMatch(/or \(stories\.gathering_id is not null and public\.viewer_was_at_gathering\(stories\.gathering_id\)\)/);
    expect(m).toMatch(/stories\.gathering_id is null\s+and stories\.expires_at > now\(\)\s+and \(\s+stories\.is_public = true/);
    expect(m).toMatch(/not public\.viewer_blocked_either_way\(stories\.user_id\)/);
  });
  test('attaching needs to have been there; the media follows its row; the map and the new-story push skip memories', () => {
    expect(m).toMatch(/and \(gathering_id is null or public\.viewer_was_at_gathering\(gathering_id\)\)/);
    expect(m).toMatch(/bucket_id = 'stories'\s+and exists \(select 1 from public\.stories s where s\.media_path = objects\.name\)/);
    expect(m).toMatch(/and s\.gathering_id is null/);
    expect(m).toMatch(/if new\.gathering_id is not null then\s+return new;/);
  });
});

describe('item 123: "📸 N memories" on Plans -> Past only, static, the whole card opens the memories', () => {
  test('a line only for a completed gathering with at least one visible memory', () => {
    expect(memoryCountFor({ ...over, isHost: true }, 4, now)).toBe(4);
    expect(memoryCountFor({ ...over, myStatus: 'approved' }, 1, now)).toBe(1);
    for (const n of [0, undefined, null, NaN, 2.5]) expect(memoryCountFor({ ...over, isHost: true }, n, now)).toBe(null);
    expect(memoryCountFor({ ...going, isHost: true }, 4, now)).toBe(null);
    expect(memoryCountFor({ ...over, myStatus: 'pending' }, 4, now)).toBe(null);
  });
  test('Plans: Past tab only; the card one tap opens the gathering with its viewer open; otherwise the normal card', () => {
    const p = code('src/screens/PlansScreen.js');
    expect(p).toMatch(/const memoryCount = tab === 'past'\s+\? memoryCountFor\(/);
    expect(p).toMatch(/extraLine=\{memoryCount \? t\('ui\.gatheringMemories\.count', \{ count: memoryCount \}\) : null\}/);
    expect(p).toMatch(/onPress=\{\(\) => \(memoryCount \? navigation\.navigate\('GatheringDetail', \{ gatheringId: g\.id, openMemories: true \}\) : openGathering\(g\.id\)\)\}/);
    expect(ALL.filter((f) => /getGatheringMemoryCounts\(/.test(code(f))).sort()).toEqual(['src/screens/PlansScreen.js', 'src/services/stories.js']);
    expect(ALL.filter((f) => /extraLine=/.test(code(f)))).toEqual(['src/screens/PlansScreen.js']);
  });
  test('the count is the same RLS-checked table read as the photos (no RPC, no second rule)', () => {
    const s = code('src/services/stories.js');
    expect(s).toMatch(/from\('stories'\)\.select\('gathering_id'\)\.in\('gathering_id', ids\)/);
  });
  test('the detail opens the viewer only via openMemories, once the server returned memories; the line never animates', () => {
    expect(code('src/screens/GatheringDetailScreen.js')).toMatch(/openOnLoad=\{route\.params\?\.openMemories === true\}/);
    const c = code('src/components/GatheringMemories.js');
    expect(c).toMatch(/if \(!openOnLoad \|\| openedOnLoad\.current \|\| !memories \|\| memories\.length === 0\) return;/);
    expect(code('src/components/PlanCard.js')).not.toMatch(/Animated|motion\//);
  });
});

// Skill level (owner item 67, 2026-09-25): who a gathering suits by ability, asked only WHERE RELEVANT, with the choices that fit
// its kind: classes = Beginner / Intermediate / Advanced; sports = Casual / Competitive; other activities (Activities &
// Recreation, Outdoors & Nature) = Beginner / Intermediate / Advanced / All levels; anything else = not asked. Stored only as
// `gatherings.skill_level` (host-declared, NULL = not said, never inferred; migration 20270206). The ask names a level by
// deterministic phrase rules on the person's own words (never AI). Ranking only: a fit lifts, a clear mismatch sinks a little,
// unknown is untouched, nothing is removed. Scoped to typed requests only (never Home/Discover feeds).
import { CATEGORY_GROUPS } from './gatheringCategories';
import { TAG_FORMAT } from './activityFormat';

export const SKILL_LEVELS = [
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'all_levels', label: 'All levels' },
  { key: 'casual', label: 'Casual' },
  { key: 'competitive', label: 'Competitive' },
];
export const SKILL_LEVEL_KEYS = SKILL_LEVELS.map((s) => s.key);
export const skillLabel = (key) => SKILL_LEVELS.find((s) => s.key === key)?.label ?? null;

// Real canonical tags that are competitive/recreational sports (test-verified). Fitness, Yoga, Running... are activities.
export const SPORT_TAGS = ['Sports', 'Pickleball', 'Tennis', 'Basketball', 'Soccer', 'Volleyball', 'Golf', 'Bowling', 'Martial Arts'];
const ACTIVITY_GROUPS = ['activities_recreation', 'outdoors_nature'];
const CLASS_FORMATS = ['class', 'workshop'];

export const SKILL_CONTEXT_LEVELS = {
  class: ['beginner', 'intermediate', 'advanced'],
  sport: ['casual', 'competitive'],
  activity: ['beginner', 'intermediate', 'advanced', 'all_levels'],
};

// Which set applies to a gathering, from its OWN tag and declared format: 'class' | 'sport' | 'activity' | null (not asked).
export function skillContext({ tag = null, format = null } = {}) {
  if (CLASS_FORMATS.includes(format) || (tag && TAG_FORMAT[tag] === 'class')) return 'class';
  if (tag && SPORT_TAGS.includes(tag)) return 'sport';
  if (tag && CATEGORY_GROUPS.some((g) => ACTIVITY_GROUPS.includes(g.key) && g.tags.includes(tag))) return 'activity';
  return null;
}

// Create/Edit chips for that context ("Not specified" first), or null when the question does not apply.
export function skillOptionsFor(ctx) {
  const keys = SKILL_CONTEXT_LEVELS[ctx];
  if (!keys) return null;
  return [{ key: null, label: 'Not specified' }, ...keys.map((k) => ({ key: k, label: skillLabel(k) }))];
}

// A stored level is kept only when it fits the gathering's current context (a host who switches a sport to a class loses
// "Competitive" instead of saving a mismatched value).
export function cleanSkillLevel(level, ctx) {
  return level && SKILL_CONTEXT_LEVELS[ctx]?.includes(level) ? level : null;
}

// The old `beginner_friendly` flag is NOT NULL DEFAULT true on every gathering, so it cannot tell a host's "yes" from the default.
// Owner decision (item 67, LOCKED): it is no longer displayed or used for ranking anywhere; a host says who it suits through the
// declared skill level above. The column stays (stored data), nothing reads it.

const ASK = [
  { key: 'beginner', re: /\bbeginners?\b|\bnew\s+to\b|\bfirst[- ]timers?\b|\bnever\s+(played|tried|done)\b|\bnewbies?\b|\blearn(ing)?\s+(to|how)\b/i },
  { key: 'intermediate', re: /\bintermediate\b/i },
  { key: 'advanced', re: /\badvanced\b|\bexperienced\s+(players?|climbers?|runners?|riders?|surfers?)\b|\bexpert\b/i },
  { key: 'all_levels', re: /\ball\s+(skill\s+)?levels?\b|\bany\s+(skill\s+)?level\b/i },
  // "casual" alone is a casual date (activity layer), so only "casual game/match/...", or "just for fun".
  { key: 'casual', re: /\bcasual\s+(game|games|match|matches|play|league|round|pickup|\w*ball|tennis|soccer|golf|bowling)\b|\bjust\s+for\s+fun\b|\bnothing\s+competitive\b/i },
  { key: 'competitive', re: /(?<!nothing\s)\bcompetitive(ly)?\b|\bserious\s+(game|games|match|players?)\b/i },
];

export function skillLevelsFromText(text) {
  if (typeof text !== 'string' || !text) return [];
  return ASK.filter((a) => a.re.test(text)).map((a) => a.key);
}

// Explicit, conservative compatibility (owner decision, item 67, LOCKED): an asked level fits the SAME declared level or
// "All levels"; an "all levels" ask fits every declared level. Nothing else counts as a fit (Beginner is not Casual, Advanced is
// not Competitive). A clear opposite sinks modestly; everything else, and an undeclared level, is neutral.
const FITS = {
  beginner: ['beginner', 'all_levels'],
  casual: ['casual', 'all_levels'],
  intermediate: ['intermediate', 'all_levels'],
  advanced: ['advanced', 'all_levels'],
  competitive: ['competitive', 'all_levels'],
  all_levels: SKILL_LEVEL_KEYS,
};
const CONFLICTS = {
  beginner: ['advanced', 'competitive'],
  casual: ['competitive'],
  advanced: ['beginner'],
  competitive: ['casual'],
  intermediate: [],
  all_levels: [],
};

export const SKILL_FIT_POINTS = 2;
export const SKILL_MISMATCH_POINTS = -1;

export function skillFit(candidate, asked) {
  const level = candidate?.skillLevel;
  if (!Array.isArray(asked) || !asked.length || !SKILL_LEVEL_KEYS.includes(level)) return { delta: 0, reason: null };
  if (asked.some((a) => FITS[a]?.includes(level))) return { delta: SKILL_FIT_POINTS, reason: `🎯 ${skillLabel(level)}` };
  if (asked.some((a) => CONFLICTS[a]?.includes(level))) return { delta: SKILL_MISMATCH_POINTS, reason: null };
  return { delta: 0, reason: null };
}

export function applySkillToCandidates(candidates, asked) {
  if (!Array.isArray(asked) || !asked.length) return candidates;
  return candidates.map((c) => {
    const { delta, reason } = skillFit(c, asked);
    return delta ? { ...c, score: (c.score ?? 0) + delta, subtitle: c.subtitle ?? reason ?? c.subtitle } : c;
  });
}

// Create Gathering validation (owner, 2026-10-04, LOCKED). Two separate checks:
//  - stepProblems(stepKey, form): only what is needed to LEAVE that step. A required value that is missing or invalid, or
//    an entered value outside its existing constraint. An optional value left empty never blocks.
//  - publishProblems(form, steps): every check of every step, re-run right before Publish (never trusts earlier steps).
// No new required field, no inference, no new rule: each check below is a rule the flow or the database already had.
// A problem = { step, field, code }; the screen shows `code` next to `field` and stays on the step.
import { whatStepProblem } from './gatheringStructure';
import { DURATION_OPTIONS, GENRE_OPTIONS, GATHERING_FEATURE_KEYS, isMusicTag } from './gatheringPractical';
import { cleanAgeRange } from './suitedAges';
import { FORMAT_OPTIONS } from '../constants/activityFormat';
import { EFFORT_OPTIONS } from '../constants/intensityEffort';
import { VISIBILITY_OPTIONS } from '../constants/gatheringVisibility';

export const PRICE_KEYS = [null, 'free', '$', '$$', '$$$'];
export const REPEAT_KEYS = [null, 'weekly', 'biweekly', 'monthly'];
export const PARTY_TYPE_KEYS = [null, 'friends', 'date', 'family', 'coworkers', 'new_people', 'groups', 'solo'];
const inList = (list, v) => list.includes(v ?? null);
const keysOf = (opts) => opts.map((o) => o.key ?? null);

const CHECKS = {
  what(f) {
    const p = whatStepProblem({ title: f.title, interestTag: f.interestTag });
    if (p === 'title') return [{ field: 'title', code: 'titleRequired' }];
    if (p === 'category') return [{ field: 'activity', code: 'pickActivity' }];
    return [];
  },
  when(f) {
    const at = f.scheduledAt instanceof Date ? f.scheduledAt.getTime() : new Date(f.scheduledAt).getTime();
    if (!f.whenPreset || !Number.isFinite(at) || at <= f.now) return [{ field: 'time', code: 'pickTime' }];
    return [];
  },
  invite() { return []; }, // optional: nobody has to be invited
  where(f) {
    if (f.locationMode === 'choose_place' && !f.customLocation) return [{ field: 'place', code: 'pickPlace' }];
    return [];
  },
  details(f) {
    const out = [];
    if (!inList(REPEAT_KEYS, f.recurrenceRule)) out.push({ field: 'repeats', code: 'invalidChoice' });
    if (!inList(PRICE_KEYS, f.priceLevel)) out.push({ field: 'price', code: 'invalidChoice' });
    if (!inList(keysOf(DURATION_OPTIONS), f.durationMinutes)) out.push({ field: 'duration', code: 'invalidChoice' });
    if (!inList(keysOf(FORMAT_OPTIONS), f.format)) out.push({ field: 'format', code: 'invalidChoice' });
    if (!inList(keysOf(EFFORT_OPTIONS), f.effortLevel)) out.push({ field: 'effort', code: 'invalidChoice' });
    if (isMusicTag(f.interestTag) && !inList(keysOf(GENRE_OPTIONS), f.genre)) out.push({ field: 'genre', code: 'invalidChoice' });
    if (!inList(PARTY_TYPE_KEYS, f.partyType)) out.push({ field: 'partyType', code: 'invalidChoice' });
    if ((f.features ?? []).some((k) => !GATHERING_FEATURE_KEYS.includes(k))) out.push({ field: 'features', code: 'invalidChoice' });
    const ages = cleanAgeRange(f.ageMin, f.ageMax);
    if (ages.min !== (f.ageMin ?? null) || ages.max !== (f.ageMax ?? null)) out.push({ field: 'ages', code: 'invalidChoice' });
    return out;
  },
  settings(f) {
    const out = [];
    if (!VISIBILITY_OPTIONS.some((v) => v.key === f.visibility)) out.push({ field: 'visibility', code: 'invalidChoice' });
    if (f.visibility === 'community' && !f.communityId) {
      out.push({ field: 'community', code: f.hasCommunities === false ? 'noCommunities' : 'pickCommunity' });
    }
    // Capacity = total people incl. the host; when set it must be a whole number of at least 1 (server rule).
    if (f.capacity != null && !(Number.isInteger(f.capacity) && f.capacity >= 1)) out.push({ field: 'capacity', code: 'invalidCapacity' });
    return out;
  },
  publish() { return []; },
};

export function stepProblems(stepKey, form) {
  const check = CHECKS[stepKey];
  return check ? check({ now: Date.now(), ...form }).map((p) => ({ step: stepKey, ...p })) : [];
}

// Every step the flow contains (a skipped What step still has its values checked: it was skipped only because they were valid).
export function publishProblems(form, stepKeys = ['what', 'when', 'invite', 'where', 'details', 'settings']) {
  const keys = [...new Set(['what', ...stepKeys])].filter((k) => k !== 'publish');
  return keys.flatMap((k) => stepProblems(k, form));
}

export const problemFor = (problems, field) => problems.find((p) => p.field === field) ?? null;

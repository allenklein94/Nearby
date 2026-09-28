// "Surprise Me" (critique item 28, built 2026-09-11 per direct user
// request). A small, secondary action beside Home's own "What do you want
// to do?" ask box -- not a new screen, not a new Discover mode. Per the
// user's own explicit design: quick pickers only (no free text, no AI
// date/time inference), one assembled suggestion at a time (never a list
// to browse), and an optional "you could go with {friend}" enrichment that
// only ever names an already-connected friend/match, never a stranger.
//
// The pure mood/pool/selection/enrichment-matching logic lives in
// surpriseMeLogic.js (re-exported below) so it stays unit-testable in the
// plain-node Jest environment; this file is the thin async orchestrator
// that wires that logic to the same real resolveIntent()/getMyFriends()/
// getMyMatches() this app already has -- same "reuse what's already real,
// invent nothing new" discipline as experienceAssembly.js.
import { resolveIntent, navigateToIntentResultItem } from './intentResolver';
import { classifyCreateRequest } from './createAssistant';
import { getMyFriends } from './friends';
import { getMyMatches } from './matchActions';
import { supabase } from './supabase';
import { isCalendarIntegrationEnabled, getUpcomingCalendarEvents } from './deviceCalendar';
import { nearestCalendarHint, formatCalendarEventDateLabel } from '../utils/calendarOccasionSuggestion';
import {
  moodToParams,
  categoryPoolForMood,
  pickSampleCategories,
  mergeCandidatePools,
  stripSurprisePhrase,
  surpriseCategories,
  surpriseBasis,
  surpriseBasisParts,
  findConnectedPersonForPicks,
  surpriseScope,
  inSurpriseScope,
  surpriseStateFrom,
  EMPTY_SURPRISE,
  pickLanes,
  undecidedPlanRecipe,
  undecidedHeader,
} from './surpriseMeLogic';
import { cuisineFromText } from '../constants/categoryTree';
import { dateWindowFromText } from '../utils/askResolver';
import { assembleExperience } from './experienceAssembly';
import { stripUndecidedPhrase } from '../constants/undecidedAsk';

export {
  WHEN_OPTIONS,
  MOOD_OPTIONS,
  moodToParams,
  categoryPoolForMood,
  pickSampleCategories,
  mergeCandidatePools,
  eligibleCandidates,
  suggestionTags,
  suggestionCandidateKeys,
  findConnectedPerson,
  surpriseAskFromText,
  stripSurprisePhrase,
  surpriseCategories,
  surpriseBasis,
  surpriseBasisParts,
  findConnectedPersonForPicks,
  SURPRISE_PICK_COUNT,
  saidCategory,
  surpriseScope,
  inSurpriseScope,
  scopeLabel,
  THINGS_TO_DO_GROUPS,
  surpriseTypesForTab,
  surpriseShownKeys,
  surpriseStateFrom,
  EMPTY_SURPRISE,
  pickForMeKind,
  pickLanes,
  UNDECIDED_LANES,
  fitsFriends,
  fitsActive,
  fitsEasy,
  undecidedPlanRecipe,
  undecidedHeader,
} from './surpriseMeLogic';
export { undecidedAskFromText } from '../constants/undecidedAsk';

// Connected people only ADD an optional "your friend likes this" line to a suggestion; when they cannot be loaded the
// suggestion is shown without it (no claim about friends is made either way), and the failure is logged, not silent.
const logSoftFailure = (what) => (e) => { console.error(`${what} failed`, e); return []; };

// Real accepted friends + real matches, deduped by id (someone can be both
// a friend and a match), each carrying their own real declared interests --
// reads `profiles.interests` the same already-open way DiscoveryScreen's
// own Browse candidate query already does (see proximity.js's
// getBrowseMatches), not a new privileged read path.
export async function getConnectedPeopleWithInterests() {
  const [friends, matches] = await Promise.all([
    getMyFriends().catch(logSoftFailure('surprise friends')),
    getMyMatches().catch(logSoftFailure('surprise matches')),
  ]);
  const byId = new Map();
  for (const f of friends) if (f.id) byId.set(f.id, { id: f.id, name: f.display_name, photo_url: f.photo_url });
  for (const m of matches) if (m.id) byId.set(m.id, { id: m.id, name: m.display_name, photo_url: m.photo_url });
  const ids = Array.from(byId.keys());
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('profiles').select('id, interests').in('id', ids);
  if (error) {
    console.error('getConnectedPeopleWithInterests error', error);
    return Array.from(byId.values()).map((p) => ({ ...p, interests: [] }));
  }
  const interestsById = new Map((data ?? []).map((row) => [row.id, row.interests ?? []]));
  return Array.from(byId.values()).map((p) => ({ ...p, interests: interestsById.get(p.id) ?? [] }));
}

async function fetchMyInterests() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];
  const { data, error } = await supabase.from('profiles').select('interests').eq('id', myId).single();
  if (error) return [];
  return data?.interests ?? [];
}

const CATEGORY_SAMPLE_SIZE = 3;

// Item 75 (CLAUDE.md): "use calendar signals to improve... Surprise Me."
// Best-effort, purely additive context -- only ever runs if the user has
// already opted in to calendar integration elsewhere (OccasionsScreen);
// Surprise Me itself never requests calendar permission. Fails open to
// null on any error, exactly like the rest of this file's other optional
// enrichments (getConnectedPeopleWithInterests).
async function getCalendarHint() {
  try {
    const enabled = await isCalendarIntegrationEnabled();
    if (!enabled) return null;
    const events = await getUpcomingCalendarEvents(7);
    const hint = nearestCalendarHint(events, 5);
    if (!hint) return null;
    return { title: hint.title, dateLabel: formatCalendarEventDateLabel(hint.startDate), startDate: hint.startDate };
  } catch (e) {
    console.error('getCalendarHint failed', e);
    return null;
  }
}

// The one async orchestrator this module exposes -- everything it calls is
// already-real (resolveIntent, getMyFriends/getMyMatches, a plain profiles
// read). No new table, no new RPC, no new location code: resolveIntent()
// already resolves the device's own location internally and degrades to
// fewer/no candidates (never a crash, never a fabricated result) when
// permission is denied.
// Ways in, ONE engine: the Home sheet ({ when, mood } chips), or typed words ({ text }) in Home's ask box or Discover's search box
// ("surprise me ...", "I don't know what I want", "what's good tonight"). Signals, all from existing sources: time (words or the
// chip, never invented), location + weather (resolveIntent), interests (broad only), budget and party (the words), connected friends.
// ONE Surprise Me (owner, 2026-09-27, LOCKED): "surprise me", "I don't know what I want", "what's good tonight" and the Home sheet
// are the same intent and produce the same result model -- up to SURPRISE_PICK_COUNT (3) labeled rows (Best Pick, With Friends,
// Something Active, Something Easy), each shown only when a real result backs its label (pickLanes). The varied-picks rules are the
// selection underneath the rows: different kinds of things when the request is broad, variety within the named scope when the
// words narrow it, never an item or a business twice. Explicit words decide the scope (category, cuisine, group, energy); the AI can
// neither narrow nor broaden (its category, cuisine, attributes and occasion are ignored; time comes from the words only, never
// invented). Surface options (never AI): `types` = Discover's type tab, `openNow` = Discover's Open-now chip; both only narrow.
// Shuffle Again passes `exclude` = the previous set. Nothing here writes the search log.
export async function runSurpriseMe({ when = null, mood = null, text = null, exclude = null, types = null, openNow = false } = {}) {
  const typed = typeof text === 'string';
  const rest = typed ? stripUndecidedPhrase(stripSurprisePhrase(text)) : '';
  let ask = {};
  if (typed && rest.length >= 2) {
    try { ask = await classifyCreateRequest(rest); } catch (e) { console.error('surprise classify skipped', e); ask = {}; }
  }
  // Typed: only word-backed facts (who with, party size, budget are words-only in resolveAsk); attributes, occasion and cuisine are
  // left to the resolver's own word readers, so an AI guess can never narrow the set.
  const params = typed ? { occasion: null, attributes: [], partyType: ask.partyType ?? null } : moodToParams(mood);
  const scope = typed ? surpriseScope(rest) : { level: 'broad' };
  const broad = scope.level === 'broad';
  const myInterests = (typed && broad) || mood === 'something_new' ? await fetchMyInterests() : [];
  // Broad: two declared interests + one new tag for range, plus one uncategorized open search (no category forced). A named tag
  // searches that tag; any other explicit scope searches without a category and keeps only what is confirmed inside it.
  const categories = typed
    ? (scope.level === 'tags' ? scope.tags : broad ? [...new Set([...surpriseCategories(myInterests), null])] : [null])
    : pickSampleCategories(categoryPoolForMood(mood, myInterests), CATEGORY_SAMPLE_SIZE);
  const dateWindow = typed ? dateWindowFromText(rest) : when;
  const cuisine = typed ? cuisineFromText(rest) : null;

  const [results, calendarHint] = await Promise.all([
    Promise.all(
      categories.map((category) =>
        resolveIntent({
          category,
          dateWindow,
          rawText: rest,
          partyType: params.partyType,
          partySize: typed ? (ask.partySize ?? null) : null,
          priceLevel: typed ? (ask.priceLevel ?? null) : null,
          budgetMax: typed ? (ask.budgetMax ?? null) : null,
          cuisine,
          attributes: params.attributes,
          occasion: params.occasion,
          openNowChip: !!openNow,
          // an uncategorized broad search is open-ended: service businesses are left out (utils/openEndedAsk.js)
          openEnded: typed && broad && category == null,
        }).catch(() => ({ items: [], experience: null }))
      )
    ),
    getCalendarHint(),
  ]);

  const pool = mergeCandidatePools(results.map((r) => r.items))
    .filter((c) => inSurpriseScope(c, scope))
    .filter((c) => !Array.isArray(types) || types.includes(c.type));
  // Best Pick's plan: a real plan the resolver assembled from the words, else the existing recipe the stated time names.
  const recipe = undecidedPlanRecipe(dateWindow);
  const experience = results.find((r) => r.experience)?.experience
    ?? (recipe ? assembleExperience(null, pool, { dateWindow, intentRecipe: recipe }) : null);

  const excludeKeys = exclude instanceof Set ? exclude : new Set(exclude ?? []);
  const lanes = pickLanes(pool, { experience, excludeKeys, level: broad ? 'broad' : 'scoped' });
  const suggestion = lanes.length > 0 ? { kind: 'lanes' } : null;
  const connectedPeople = suggestion ? await getConnectedPeopleWithInterests().catch(logSoftFailure('surprise connected people')) : [];
  const connectedPerson = suggestion ? findConnectedPersonForPicks(lanes.flatMap((l) => l.items), connectedPeople) : null;
  const basisOpts = typed
    ? {
      usedInterests: broad && categories.some(Boolean), scope, budgetMax: ask.budgetMax ?? null,
      priceLevel: ask.priceLevel ?? null, partyType: ask.partyType ?? null,
    }
    : { partyType: params.partyType };
  const basis = surpriseBasis(basisOpts);
  const basisParts = surpriseBasisParts(basisOpts);
  // Every eligible real result was already shown last time: say so rather than repeating it.
  const exhausted = !suggestion && excludeKeys.size > 0 && pool.length > 0;

  return {
    header: undecidedHeader(dateWindow), lanes, suggestion, pool, connectedPeople, connectedPerson,
    calendarHint, basis, basisParts, dateWindow, ask, rest, scope, exhausted,
  };
}

// ---- The shared surface flow (Home's ask box + sheet, Discover's search box): one submit, one shuffle, one tap. ----

// A run -> the state a surface keeps. A failure is an empty result (never a fabricated one) and never throws to the surface.
export async function submitSurprise(args) {
  try {
    return surpriseStateFrom(args, await runSurpriseMe(args));
  } catch (e) {
    console.error('runSurpriseMe failed', e);
    return { args, ...EMPTY_SURPRISE, shown: new Set() };
  }
}

// Shuffle Again: a FRESH fetch of the same ask avoiding the immediately previous set. Nothing new = keep the previous set and say
// so (`exhausted`); a failure keeps the previous set unchanged.
export async function shuffleSurprise(previous) {
  if (!previous) return previous;
  try {
    const r = await runSurpriseMe({ ...previous.args, exclude: previous.shown });
    if (!r.suggestion) return { ...previous, exhausted: true };
    return surpriseStateFrom(previous.args, r);
  } catch (e) {
    console.error('runSurpriseMe shuffle failed', e);
    return { ...previous, exhausted: false };
  }
}

// Opening a pick: the same router every typed ask uses. Only the surprise's own word-backed time (and the sheet's mood occasion)
// prefill a business request; nothing is recorded to the search log.
export function navigateToSurprisePick(navigation, item, surprise) {
  navigateToIntentResultItem(navigation, item, {
    typedText: surprise?.rest ?? '',
    classifyResult: {
      category: item.category ?? null,
      dateWindow: surprise?.dateWindow ?? null,
      occasion: item.type === 'business_availability'
        ? (surprise?.args?.mood ? moodToParams(surprise.args.mood).occasion : (surprise?.ask?.occasion ?? null))
        : null,
    },
  });
}

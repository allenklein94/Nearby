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
import { resolveIntent } from './intentResolver';
import { getMyFriends } from './friends';
import { getMyMatches } from './matchActions';
import { supabase } from './supabase';
import {
  moodToParams,
  categoryPoolForMood,
  pickSampleCategories,
  mergeCandidatePools,
  pickSuggestion,
  findConnectedPerson,
} from './surpriseMeLogic';

export {
  WHEN_OPTIONS,
  MOOD_OPTIONS,
  moodToParams,
  categoryPoolForMood,
  pickSampleCategories,
  mergeCandidatePools,
  eligibleCandidates,
  pickSuggestion,
  pickNextFromPool,
  suggestionTags,
  suggestionCandidateKeys,
  findConnectedPerson,
} from './surpriseMeLogic';

// Real accepted friends + real matches, deduped by id (someone can be both
// a friend and a match), each carrying their own real declared interests --
// reads `profiles.interests` the same already-open way DiscoveryScreen's
// own Browse candidate query already does (see proximity.js's
// getBrowseMatches), not a new privileged read path.
export async function getConnectedPeopleWithInterests() {
  const [friends, matches] = await Promise.all([
    getMyFriends().catch(() => []),
    getMyMatches().catch(() => []),
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

// The one async orchestrator this module exposes -- everything it calls is
// already-real (resolveIntent, getMyFriends/getMyMatches, a plain profiles
// read). No new table, no new RPC, no new location code: resolveIntent()
// already resolves the device's own location internally and degrades to
// fewer/no candidates (never a crash, never a fabricated result) when
// permission is denied.
export async function runSurpriseMe({ when, mood }) {
  const params = moodToParams(mood);
  const myInterests = mood === 'something_new' ? await fetchMyInterests() : [];
  const pool = categoryPoolForMood(mood, myInterests);
  const categories = pickSampleCategories(pool, CATEGORY_SAMPLE_SIZE);

  const results = await Promise.all(
    categories.map((category) =>
      resolveIntent({
        category,
        dateWindow: when,
        rawText: '',
        partyType: params.partyType,
        attributes: params.attributes,
        occasion: params.occasion,
      }).catch(() => ({ items: [], experience: null }))
    )
  );

  const merged = mergeCandidatePools(results.map((r) => r.items));
  // Only one call can ever produce a real cross-category experience here:
  // occasion is only ever set for the "date" mood, and every sampled
  // category shares that same single occasion, so at most the first
  // non-null result matters -- never merged, since a merged "experience"
  // would mix two independently-assembled recipes into one fabricated one.
  const experience = results.find((r) => r.experience)?.experience ?? null;

  const suggestion = pickSuggestion(experience, merged);
  const connectedPeople = suggestion ? await getConnectedPeopleWithInterests().catch(() => []) : [];
  const connectedPerson = suggestion ? findConnectedPerson(suggestion, connectedPeople) : null;

  return { suggestion, pool: merged, connectedPeople, connectedPerson };
}

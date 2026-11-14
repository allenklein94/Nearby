/**
 * PROXIMITY SERVICE
 *
 * "Crossed paths" detection works by periodically reporting a coarse,
 * rounded location to the backend — both in the foreground (when the
 * app is open) and in the background (via a registered location task),
 * so real-world crossed-paths moments are captured even when the app
 * isn't actively open on screen. The backend (report-presence Edge
 * Function) compares area buckets across users to find matches.
 *
 * The same location fetch also populates a much coarser wide_area
 * bucket (~6-7 mile grid) on the person's own profile, used only for
 * the optional Browse mode — a wider, filter-based discovery pool
 * that isn't limited to actual crossed-paths proximity. This reuses
 * the same coarse-bucketing privacy pattern already used for
 * Gatherings' wide-radius tier, never exact coordinates.
 */

import * as Location from 'expo-location';
import { getUserLocation } from './userLocation';
import { selectPeople } from './peopleRead';
import * as TaskManager from 'expo-task-manager';
import { supabase, functionUrl } from './supabase';
import { readMyProfile } from './myProfile';
import { calculateCompatibility } from './compatibility';
import { getMyActiveLiveTrackingSession } from './liveTracking';
import { mergeCrossedPathsSignals } from './crossedPathsSignals';
import { isDatingOptedIn } from '../utils/datingCountConsent';
import { appearancePreferencesOf, rankDatingCandidates } from '../utils/datingAppearance';
import { createBrowsePool, BROWSE_PAGE_SIZE } from '../utils/browsePool';
import { readWithOptionalColumns } from '../utils/optionalProfileColumns';

// Unified Crossed Paths, step 3 (CLAUDE.md, 2026-09-10): the shared-
// gathering-attendance half of the signal union -- see
// get_shared_gathering_partners() (20260930_shared_gathering_crossed_
// paths.sql) and crossedPathsSignals.js's own header comment for the
// full locked design. Kept local to this file (not in the shared pure
// module) since it's a real supabase RPC call, not pure logic --
// friendDiscovery.js's own getFriendCrossedPaths() calls the same RPC
// independently rather than sharing this wrapper, since the two
// services deliberately don't import from each other.
async function getSharedGatheringPartners() {
  const { data, error } = await supabase.rpc('get_shared_gathering_partners');
  if (error) {
    console.error('getSharedGatheringPartners error', error);
    return [];
  }
  return data ?? [];
}

const BACKGROUND_LOCATION_TASK = 'nearby-background-location-task';

// The one Dating candidate read's columns (both Dating reads below).
const DATING_CANDIDATE_COLUMNS = 'id, display_name, photo_url, bio, discovery_gender, age, ethnicity, interests, basics, height_inches, photo_verified, id_verified, relationship_intention, gender_identity, interested_in_genders, show_me, dating_opted_in';

export async function requestLocationPermission() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function requestBackgroundLocationPermission() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return false;

  const background = await Location.requestBackgroundPermissionsAsync();
  return background.status === 'granted';
}

function coarseAreaLabel(latitude, longitude) {
  const bucketLat = Math.round(latitude * 10000) / 10000;
  const bucketLng = Math.round(longitude * 10000) / 10000;
  return `${bucketLat},${bucketLng}`;
}

function wideAreaLabel(latitude, longitude) {
  const bucketLat = Math.round(latitude * 10) / 10;
  const bucketLng = Math.round(longitude * 10) / 10;
  return `${bucketLat},${bucketLng}`;
}

async function sendPresenceReport(latitude, longitude) {
  const area = coarseAreaLabel(latitude, longitude);

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const userId = sessionData?.session?.user?.id;
  if (!token || !userId) return;

  await fetch(functionUrl('report-presence'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ area }),
  }).catch((err) => console.error('background presence report failed', err));

  // Same location fetch, no extra permission prompt or GPS call —
  // just also updates the much coarser wide_area bucket used by
  // Browse mode.
  await supabase
    .from('profiles')
    .update({ wide_area: wideAreaLabel(latitude, longitude) })
    .eq('id', userId)
    .then(({ error }) => {
      if (error) console.error('wide_area update failed', error);
    });

  // Same location fetch again — if the person has an active Live
  // Tracking session (started from a chat's Date Safety check-in),
  // update its precise position too. Reusing this existing periodic
  // reporting means live tracking works in the background without a
  // second, separate location task.
  const activeSession = await getMyActiveLiveTrackingSession();
  if (activeSession) {
    await supabase
      .from('live_tracking_sessions')
      .update({ current_lat: latitude, current_lng: longitude, updated_at: new Date().toISOString() })
      .eq('id', activeSession.id)
      .then(({ error }) => {
        if (error) console.error('live tracking location update failed', error);
      });
  }
}

// Foreground presence report from the shared location provider: one permission check for the whole app (this
// used to prompt on every Discovery load), same fix everything else uses. Returns false when there's no position.
export async function reportPresence() {
  const location = await getUserLocation({ fresh: true });
  if (!location) return false;
  await sendPresenceReport(location.coords.latitude, location.coords.longitude);
  return true;
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background location task error', error);
    return;
  }
  if (data) {
    const { locations } = data;
    const latest = locations?.[0];
    if (latest) {
      await sendPresenceReport(latest.coords.latitude, latest.coords.longitude);
    }
  }
});

export async function startBackgroundPresenceReporting() {
  const hasBackgroundPermission = await requestBackgroundLocationPermission();
  if (!hasBackgroundPermission) {
    console.log('Background location permission not granted; foreground-only presence reporting will be used.');
    return;
  }

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (alreadyStarted) return;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 5 * 60 * 1000,
    distanceInterval: 50,
    showsBackgroundLocationIndicator: false,
    foregroundService: {
      notificationTitle: 'Nearby is checking for crossed paths',
      notificationBody: 'Tap to open the app',
    },
  });
}

export async function stopBackgroundPresenceReporting() {
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (alreadyStarted) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}

function passesGenderMatch(myProfile, theirProfile) {
  const myIdentity = myProfile?.gender_identity ?? [];
  const myInterestedIn = myProfile?.interested_in_genders ?? [];
  const theirIdentity = theirProfile?.gender_identity ?? [];
  const theirInterestedIn = theirProfile?.interested_in_genders ?? [];

  const bothHaveNewFields = myIdentity.length > 0 && myInterestedIn.length > 0 && theirIdentity.length > 0 && theirInterestedIn.length > 0;

  if (bothHaveNewFields) {
    const iWantThem = theirIdentity.some((g) => myInterestedIn.includes(g));
    const theyWantMe = myIdentity.some((g) => theirInterestedIn.includes(g));
    return iWantThem && theyWantMe;
  }

  const showMe = myProfile?.show_me ?? 'Everyone';
  if (showMe !== 'Everyone' && theirProfile?.discovery_gender !== showMe) {
    return false;
  }
  return true;
}

export async function getNearbyMatches() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return [];

  // Blocking hides a pair in BOTH directions, decided by the server where the rows are read: sightings (is_blocked in
  // its policy), get_shared_gathering_partners and people_visible_to_me (viewer_blocked_either_way, 20270265). The
  // client never reads `blocks` (blocks RLS hides other people's blocks, so it could only see one direction).

  const { data: sessionForFriends } = await supabase.auth.getSession();
  const myIdForFriends = sessionForFriends?.session?.user?.id;
  const { data: acceptedFriends } = await supabase
    .from('friendships')
    .select('user_a, user_b')
    .eq('status', 'accepted')
    .or(`user_a.eq.${myIdForFriends},user_b.eq.${myIdForFriends}`);

  const excludedUserIds = new Set([
    // Once a friendship is confirmed, that person shouldn't keep
    // showing up here to Notice/Wave — it risks creating a
    // duplicate match on top of the friendship, and someone you've
    // already connected with as a friend doesn't need to be
    // re-surfaced as a dating prospect.
    ...(acceptedFriends ?? []).map((f) => (f.user_a === myIdForFriends ? f.user_b : f.user_a)),
  ]);

  const { data: myProfile } = await readMyProfile('show_me, preferred_min_age, preferred_max_age, ethnicity_preferences, dating_pref_hair_colors, dating_pref_eye_colors, dating_pref_min_height_inches, dating_pref_max_height_inches, interests, basics, gender_identity, interested_in_genders');

  const minAge = myProfile?.preferred_min_age ?? 18;
  const maxAge = myProfile?.preferred_max_age ?? 99;
  const ethnicityPreferences = myProfile?.ethnicity_preferences ?? [];

  const { data: sightings, error } = await supabase
    .from('sightings')
    .select('id, user_a, user_b, last_seen_at')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order('last_seen_at', { ascending: false });

  if (error) {
    console.error('getNearbyMatches error', error);
    return [];
  }

  const gatheringPartners = await getSharedGatheringPartners();

  // Unified Crossed Paths (CLAUDE.md, 2026-09-10): the candidate pool is
  // now the union of real proximity sightings and real shared-past-
  // gathering attendance, not sightings alone -- mergeCrossedPathsSignals
  // prefers the gathering explanation over proximity whenever both are
  // real for the same pair, never blending them. Every filter below
  // (matches/blocks/friends exclusion, then dating eligibility) applies
  // identically to both signal types.
  const sightingSignals = (sightings ?? []).map((s) => ({
    otherUserId: s.user_a === userId ? s.user_b : s.user_a,
    last_seen_at: s.last_seen_at,
    sightingId: s.id,
  }));
  const merged = mergeCrossedPathsSignals(sightingSignals, gatheringPartners);
  if (merged.length === 0) return [];

  const { data: existingMatches } = await supabase
    .from('matches')
    .select('user_a, user_b')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);

  const matchedUserIds = new Set(
    (existingMatches ?? []).map((m) => (m.user_a === userId ? m.user_b : m.user_a))
  );

  const eligible = merged.filter((m) => !matchedUserIds.has(m.otherUserId) && !excludedUserIds.has(m.otherUserId));

  if (eligible.length === 0) return [];

  const otherUserIds = eligible.map((m) => m.otherUserId);

  // Item 121 follow-up: Dating consent is decided by the server (dating_candidates_visible_to_me, 20270314): a sighting or
  // a shared gathering whose person never chose Dating returns no profile, so it never becomes a card or a count.
  const { data: profiles, error: profilesError } = await selectPeople((columns) => supabase
    .from('dating_candidates_visible_to_me')
    .select(columns)
    .in('id', otherUserIds), DATING_CANDIDATE_COLUMNS);

  if (profilesError) {
    console.error('getNearbyMatches profiles error', profilesError);
    return [];
  }

  const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));

  return eligible
    .map((m) => {
      const otherProfile = profileById[m.otherUserId] ?? null;

      const sharedInterests = otherProfile
        ? (otherProfile.interests ?? []).filter((i) => (myProfile?.interests ?? []).includes(i))
        : [];

      const compatibilityScore = otherProfile ? calculateCompatibility(myProfile, otherProfile) : null;

      return {
        // A gathering-only candidate has no real sighting row to key off
        // of -- falls back to a synthetic-but-stable id so FlatList/
        // photoUrls keying still works. Never reuses a real sighting id
        // for a gathering-only match.
        id: m.sightingId ?? `gathering-${m.crossedPathsReason.gatheringId}-${m.otherUserId}`,
        last_seen_at: m.last_seen_at,
        sightingLat: m.sightingLat,
        sightingLng: m.sightingLng,
        otherUserId: m.otherUserId,
        profiles: otherProfile,
        sharedInterests,
        compatibilityScore,
        crossedPathsReason: m.crossedPathsReason,
      };
    })
    .filter((item) => item.profiles !== null && isDatingOptedIn(item))
    .filter((item) => {
      if (!passesGenderMatch(myProfile, item.profiles)) {
        return false;
      }
      const age = item.profiles.age ?? null;
      if (age !== null && (age < minAge || age > maxAge)) {
        return false;
      }
      if (ethnicityPreferences.length > 0 && !ethnicityPreferences.includes(item.profiles.ethnicity)) {
        return false;
      }
      // Hair color, eye color and height never exclude (owner, 2026-11-14): they are soft preferences, used only to
      // order Browse (utils/datingAppearance.js). Crossed Paths keeps its own order.
      return true;
    });
}

// Dating Browse (owner, 2026-11-14, Option A): a second, optional discovery mode, NOT proximity-bound like Crossed
// Paths. The candidates are anyone in the same coarse wide_area bucket (~6-7 mile grid) or its 8 neighbours who chose
// Dating (dating_candidates_visible_to_me), minus friends, matches and the person's hard filters. They are read in
// windows of BROWSE_POOL_WINDOW, filtered and ranked as one set (compatibility + the approved appearance adjustment,
// utils/datingAppearance.js), and revealed BROWSE_PAGE_SIZE at a time (utils/browsePool.js); the pool is reused while
// fresh. Global order is within each window of 300, not across the whole Dating pool. Crossed Paths stays the default,
// primary experience.
//
// Returns { items, hasMore, failed, reset }:
//   hasMore comes from the pool, never from an empty page;
//   failed = a read failed (network, server): nothing changed, the same offset can be asked again; never "no more";
//   reset  = a NEW pool had to be built while the screen was past page 1 (inputs changed, or the pool was dropped):
//            items are page 1 of the new pool and the screen replaces its list (never mixes two pools' positions).
let browsePoolCache = null;

// Drops the reused pool (pull to refresh, Dating preferences saved, sign out). The next read builds a new one.
export function resetBrowsePool() {
  browsePoolCache = null;
}

function neighborBucketsOf(wideArea) {
  // The current bucket plus its 8 neighbours: two people in the same broad area can round into different buckets.
  const [bucketLat, bucketLng] = wideArea.split(',').map(Number);
  const buckets = [];
  for (const dLat of [-0.1, 0, 0.1]) {
    for (const dLng of [-0.1, 0, 0.1]) {
      buckets.push(`${Math.round((bucketLat + dLat) * 10) / 10},${Math.round((bucketLng + dLng) * 10) / 10}`);
    }
  }
  return buckets;
}

// Narrow window read (optimization pass, 2026-11-14): only what the hard filters (consent, gender, age, ethnicity) and
// ranking (compatibility: interests, basics, relationship_intention; appearance: basics hair/eye, height_inches) read.
// Card details (name, photo path, bio, badges) come only for the 20 shown, in DATING_CANDIDATE_COLUMNS (hydrate).
export const BROWSE_RANK_COLUMNS = 'id, discovery_gender, age, ethnicity, interests, basics, height_inches, relationship_intention, gender_identity, interested_in_genders, show_me, dating_opted_in';

// PostgREST takes ids in the URL; keep each `in` list well under URL limits.
const HYDRATE_CHUNK = 100;

async function readBrowseExclusions(userId) {
  // A confirmed friend or an existing match is never re-surfaced as a dating prospect. Re-read on every page, so a new
  // friend or match leaves Browse at once. A failed read throws: Browse never shows people it couldn't check.
  const [friends, matches] = await Promise.all([
    supabase.from('friendships').select('user_a, user_b').eq('status', 'accepted').or(`user_a.eq.${userId},user_b.eq.${userId}`),
    supabase.from('matches').select('user_a, user_b').or(`user_a.eq.${userId},user_b.eq.${userId}`),
  ]);
  if (friends.error) throw friends.error;
  if (matches.error) throw matches.error;
  const other = (row) => (row.user_a === userId ? row.user_b : row.user_a);
  return new Set([userId, ...(friends.data ?? []).map(other), ...(matches.data ?? []).map(other)]);
}

async function buildBrowsePool(userId, myProfile) {
  // People in a block with me, either way, never come back from dating_candidates_visible_to_me (server rule); the
  // client never reads `blocks`.
  const minAge = myProfile?.preferred_min_age ?? 18;
  const maxAge = myProfile?.preferred_max_age ?? 99;
  const ethnicityPreferences = myProfile?.ethnicity_preferences ?? [];
  const buckets = neighborBucketsOf(myProfile.wide_area);
  const appearance = appearancePreferencesOf(myProfile);

  // The hard filters, one rule for the window and for the fresh row of a page about to show.
  const eligible = (p) => {
    if (!isDatingOptedIn({ profiles: p }) || !passesGenderMatch(myProfile, p)) return false;
    const age = p.age ?? null;
    if (age !== null && (age < minAge || age > maxAge)) return false;
    if (ethnicityPreferences.length > 0 && !ethnicityPreferences.includes(p.ethnicity)) return false;
    // Appearance preferences rank (rankDatingCandidates), never exclude (owner, 2026-11-14).
    return true;
  };

  return createBrowsePool({
    // Keyset paging by id (stable order, required for windows: no skips or repeats when rows change between reads).
    fetchWindow: async (afterId, size) => {
      const { data, error } = await selectPeople((columns) => {
        let query = supabase.from('dating_candidates_visible_to_me').select(columns).in('wide_area', buckets);
        if (afterId != null) query = query.gt('id', afterId);
        return query.order('id', { ascending: true }).limit(size);
      }, BROWSE_RANK_COLUMNS);
      if (error) throw error;
      return data ?? [];
    },
    rankWindow: (rows) => rankDatingCandidates(
      rows
        .filter(eligible)
        .map((p) => ({
          id: p.id,
          otherUserId: p.id,
          profiles: p,
          sharedInterests: (p.interests ?? []).filter((i) => (myProfile?.interests ?? []).includes(i)),
          compatibilityScore: calculateCompatibility(myProfile, p),
        })),
      appearance,
    ),
    loadExcluded: () => readBrowseExclusions(userId),
    // Before a page shows, the server re-decides who is still visible (blocks either way, Dating consent, area) and
    // returns the card details for those people only; a fresh row that no longer passes the hard filters is dropped.
    hydrate: async (ids) => {
      const rows = new Map();
      for (let i = 0; i < ids.length; i += HYDRATE_CHUNK) {
        const chunk = ids.slice(i, i + HYDRATE_CHUNK);
        // eslint-disable-next-line no-await-in-loop
        const { data, error } = await selectPeople((columns) => supabase
          .from('dating_candidates_visible_to_me')
          .select(columns)
          .in('id', chunk)
          .in('wide_area', buckets), DATING_CANDIDATE_COLUMNS);
        if (error) throw error;
        for (const row of data ?? []) if (eligible(row)) rows.set(row.id, row);
      }
      return rows;
    },
  });
}

// dating_pref_tattoos / dating_pref_piercings arrive with staged 20270417; read through readWithOptionalColumns so Browse
// works the same before it is live (no preference).
const BROWSE_PROFILE_COLUMNS = 'wide_area, show_me, preferred_min_age, preferred_max_age, ethnicity_preferences, dating_pref_hair_colors, dating_pref_eye_colors, dating_pref_min_height_inches, dating_pref_max_height_inches, dating_pref_tattoos, dating_pref_piercings, interests, basics, gender_identity, interested_in_genders';

// Everything the pool's membership or order depends on; a change means a new pool.
function browsePoolKey(userId, myProfile) {
  return JSON.stringify([userId, BROWSE_PROFILE_COLUMNS, BROWSE_PROFILE_COLUMNS.split(', ').map((c) => myProfile?.[c] ?? null)]);
}

async function readBrowseInputs() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return null;
  const { data: myProfile, error } = await readWithOptionalColumns(readMyProfile, BROWSE_PROFILE_COLUMNS);
  if (error) throw error;
  if (!myProfile?.wide_area) return null;
  return { userId, myProfile, key: browsePoolKey(userId, myProfile) };
}

export async function getBrowseMatches(offset = 0) {
  const none = { items: [], hasMore: false, failed: false, reset: false };
  try {
    const inputs = await readBrowseInputs();
    if (!inputs) return none;

    // Later pages always continue the pool the first page came from (stable positions, no reshuffle); a first page
    // reuses it only while fresh. A new pool (inputs changed, dropped, or expired at page 1) always starts at page 1.
    const sameInputs = browsePoolCache && browsePoolCache.key === inputs.key;
    const reusable = sameInputs && (offset > 0 || browsePoolCache.pool.isFresh());
    let reset = false;
    let at = offset;
    if (!reusable) {
      browsePoolCache = { key: inputs.key, pool: await buildBrowsePool(inputs.userId, inputs.myProfile) };
      if (offset > 0) { reset = true; at = 0; }
    }
    const { items, hasMore } = await browsePoolCache.pool.page(at, BROWSE_PAGE_SIZE);
    return { items, hasMore, failed: false, reset };
  } catch (error) {
    console.error('getBrowseMatches error', error);
    // The pool is left as it was (utils/browsePool.js: a failed read moves nothing), so a retry of the same offset
    // continues exactly where it stopped. Never reported as an exhausted pool.
    return { items: [], hasMore: true, failed: true, reset: false };
  }
}

// Coming back to Browse (owner, 2026-11-14): which of the people already on screen must leave now (a new friend or
// match, a block either way, left Dating), and whether the inputs changed (preferences saved) so the list must start
// over. { remove: Set, restart: bool, failed: bool }. A failed check changes nothing on screen.
export async function recheckBrowseOnReturn(shownIds) {
  try {
    const inputs = await readBrowseInputs();
    if (!inputs) return { remove: new Set(), restart: false, failed: false };
    if (!browsePoolCache || browsePoolCache.key !== inputs.key) return { remove: new Set(), restart: true, failed: false };
    return { remove: await browsePoolCache.pool.recheckShown(shownIds), restart: false, failed: false };
  } catch (error) {
    console.error('recheckBrowseOnReturn error', error);
    return { remove: new Set(), restart: false, failed: true };
  }
}

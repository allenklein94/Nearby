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
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';
import { calculateCompatibility } from './compatibility';
import { getMyActiveLiveTrackingSession } from './liveTracking';

const BACKGROUND_LOCATION_TASK = 'nearby-background-location-task';

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

  await fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/report-presence', {
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

export async function reportPresence() {
  const hasPermission = await requestLocationPermission();
  if (!hasPermission) return;

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  await sendPresenceReport(location.coords.latitude, location.coords.longitude);
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

function calculateAge(birthdateString) {
  if (!birthdateString) return null;
  const birthdate = new Date(birthdateString);
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const monthDiff = today.getMonth() - birthdate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
    age--;
  }
  return age;
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

  // Blocking must be checked in BOTH directions — if I blocked them,
  // or if they blocked me, neither of us should show up to the other.
  const { data: blockedByMe } = await supabase
    .from('blocks')
    .select('blocked_id')
    .eq('blocker_id', userId);
  const { data: blockedMe } = await supabase
    .from('blocks')
    .select('blocker_id')
    .eq('blocked_id', userId);

  const excludedUserIds = new Set([
    ...(blockedByMe ?? []).map((b) => b.blocked_id),
    ...(blockedMe ?? []).map((b) => b.blocker_id),
  ]);

  const { data: myProfile } = await supabase
    .from('profiles')
    .select('show_me, preferred_min_age, preferred_max_age, ethnicity_preferences, interests, basics, gender_identity, interested_in_genders')
    .eq('id', userId)
    .single();

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
  if (!sightings || sightings.length === 0) return [];

  const { data: existingMatches } = await supabase
    .from('matches')
    .select('user_a, user_b')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);

  const matchedUserIds = new Set(
    (existingMatches ?? []).map((m) => (m.user_a === userId ? m.user_b : m.user_a))
  );

  const otherUserIds = sightings
    .map((s) => (s.user_a === userId ? s.user_b : s.user_a))
    .filter((id) => !matchedUserIds.has(id) && !excludedUserIds.has(id));

  if (otherUserIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, display_name, photo_url, bio, discovery_gender, birthdate, ethnicity, interests, basics, photo_verified, relationship_intention, gender_identity, interested_in_genders, show_me')
    .in('id', otherUserIds);

  if (profilesError) {
    console.error('getNearbyMatches profiles error', profilesError);
    return [];
  }

  const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));

  return sightings
    .map((s) => {
      const otherUserId = s.user_a === userId ? s.user_b : s.user_a;
      const otherProfile = profileById[otherUserId] ?? null;

      const sharedInterests = otherProfile
        ? (otherProfile.interests ?? []).filter((i) => (myProfile?.interests ?? []).includes(i))
        : [];

      const compatibilityScore = otherProfile ? calculateCompatibility(myProfile, otherProfile) : null;

      return {
        id: s.id,
        last_seen_at: s.last_seen_at,
        otherUserId,
        profiles: otherProfile,
        sharedInterests,
        compatibilityScore,
      };
    })
    .filter((item) => item.profiles !== null)
    .filter((item) => {
      if (!passesGenderMatch(myProfile, item.profiles)) {
        return false;
      }
      const age = calculateAge(item.profiles.birthdate);
      if (age !== null && (age < minAge || age > maxAge)) {
        return false;
      }
      if (ethnicityPreferences.length > 0 && !ethnicityPreferences.includes(item.profiles.ethnicity)) {
        return false;
      }
      return true;
    });
}

const BROWSE_BATCH_SIZE = 20;

// A second, optional discovery mode — NOT proximity-bound like
// Crossed Paths. Pulls from anyone in the same coarse wide_area
// bucket (~6-7 mile grid) matching the person's existing filters,
// returned in batches. This exists alongside Crossed Paths as an
// additional way to browse, not a replacement for it — Crossed Paths
// remains the default, primary experience.
export async function getBrowseMatches(offset = 0) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return [];

  const { data: blockedByMe } = await supabase
    .from('blocks')
    .select('blocked_id')
    .eq('blocker_id', userId);
  const { data: blockedMe } = await supabase
    .from('blocks')
    .select('blocker_id')
    .eq('blocked_id', userId);

  const excludedUserIds = new Set([
    userId,
    ...(blockedByMe ?? []).map((b) => b.blocked_id),
    ...(blockedMe ?? []).map((b) => b.blocker_id),
  ]);

  const { data: myProfile } = await supabase
    .from('profiles')
    .select('wide_area, show_me, preferred_min_age, preferred_max_age, ethnicity_preferences, interests, basics, gender_identity, interested_in_genders')
    .eq('id', userId)
    .single();

  if (!myProfile?.wide_area) return [];

  const minAge = myProfile?.preferred_min_age ?? 18;
  const maxAge = myProfile?.preferred_max_age ?? 99;
  const ethnicityPreferences = myProfile?.ethnicity_preferences ?? [];

  const { data: existingMatches } = await supabase
    .from('matches')
    .select('user_a, user_b')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);

  const matchedUserIds = new Set(
    (existingMatches ?? []).map((m) => (m.user_a === userId ? m.user_b : m.user_a))
  );

  // Check the current bucket plus its 8 immediate neighbors, not
  // just an exact match — two people genuinely in the same broad
  // area can still land in different rounded buckets if their last
  // location updates happened to round differently near a boundary.
  const [bucketLat, bucketLng] = myProfile.wide_area.split(',').map(Number);
  const neighborBuckets = [];
  for (const dLat of [-0.1, 0, 0.1]) {
    for (const dLng of [-0.1, 0, 0.1]) {
      const lat = Math.round((bucketLat + dLat) * 10) / 10;
      const lng = Math.round((bucketLng + dLng) * 10) / 10;
      neighborBuckets.push(`${lat},${lng}`);
    }
  }

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, display_name, photo_url, bio, discovery_gender, birthdate, ethnicity, interests, basics, photo_verified, relationship_intention, gender_identity, interested_in_genders, show_me')
    .in('wide_area', neighborBuckets)
    .range(offset, offset + BROWSE_BATCH_SIZE - 1);

  if (error) {
    console.error('getBrowseMatches error', error);
    return [];
  }

  return (profiles ?? [])
    .filter((p) => !excludedUserIds.has(p.id) && !matchedUserIds.has(p.id))
    .filter((p) => passesGenderMatch(myProfile, p))
    .filter((p) => {
      const age = calculateAge(p.birthdate);
      if (age !== null && (age < minAge || age > maxAge)) return false;
      if (ethnicityPreferences.length > 0 && !ethnicityPreferences.includes(p.ethnicity)) return false;
      return true;
    })
    .map((p) => {
      const sharedInterests = (p.interests ?? []).filter((i) => (myProfile?.interests ?? []).includes(i));
      const compatibilityScore = calculateCompatibility(myProfile, p);
      return {
        id: p.id,
        otherUserId: p.id,
        profiles: p,
        sharedInterests,
        compatibilityScore,
      };
    });
}
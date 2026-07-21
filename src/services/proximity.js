/**
 * PROXIMITY SERVICE
 *
 * "Crossed paths" detection works by periodically reporting a coarse,
 * rounded location to the backend — both in the foreground (when the
 * app is open) and in the background (via a registered location task),
 * so real-world crossed-paths moments are captured even when the app
 * isn't actively open on screen. The backend (report-presence Edge
 * Function) compares area buckets across users to find matches.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';

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

async function sendPresenceReport(latitude, longitude) {
  const area = coarseAreaLabel(latitude, longitude);

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return;

  await fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/report-presence', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ area }),
  }).catch((err) => console.error('background presence report failed', err));
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

export async function getNearbyMatches() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return [];

  // Fetch the viewer's own discovery preferences first — these filter
  // who shows up for THEM specifically (one-directional, same pattern
  // Tinder/Hinge/Bumble use: your preferences control your own feed,
  // not a mutual double-filter).
  const { data: myProfile } = await supabase
    .from('profiles')
    .select('show_me, preferred_min_age, preferred_max_age')
    .eq('id', userId)
    .single();

  const showMe = myProfile?.show_me ?? 'Everyone';
  const minAge = myProfile?.preferred_min_age ?? 18;
  const maxAge = myProfile?.preferred_max_age ?? 99;

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
    .filter((id) => !matchedUserIds.has(id));

  if (otherUserIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, display_name, photo_url, bio, discovery_gender, birthdate')
    .in('id', otherUserIds);

  if (profilesError) {
    console.error('getNearbyMatches profiles error', profilesError);
    return [];
  }

  const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));

  return sightings
    .map((s) => {
      const otherUserId = s.user_a === userId ? s.user_b : s.user_a;
      return {
        id: s.id,
        last_seen_at: s.last_seen_at,
        otherUserId,
        profiles: profileById[otherUserId] ?? null,
      };
    })
    .filter((item) => item.profiles !== null)
    .filter((item) => {
      // Apply the viewer's "Show Me" preference against the other
      // person's discovery_gender.
      if (showMe !== 'Everyone' && item.profiles.discovery_gender !== showMe) {
        return false;
      }
      // Apply the viewer's age range preference. If the other person
      // hasn't set a birthdate for some reason, don't filter them out —
      // fail open rather than silently hiding profiles over missing data.
      const age = calculateAge(item.profiles.birthdate);
      if (age !== null && (age < minAge || age > maxAge)) {
        return false;
      }
      return true;
    });
}
// Item 75 (CLAUDE.md, direct user request): "Connect occasions to the
// user's calendar." Real, permission-driven, read-only integration with
// the device's own calendar app -- never a Nearby calendar feature (Item
// 76's own locked boundary: "Calendar = when, Nearby = what + who + where
// + how"). This module never calls any expo-calendar write API (no event
// create/update/delete anywhere in this file) -- it only ever reads.
//
// Two deliberate, load-bearing privacy choices:
//  1. Never blanket access. Requesting OS permission only unlocks the
//     ability to LIST calendars; which specific calendars Nearby is
//     actually allowed to read events from is a separate, explicit,
//     always-visible user choice (selectedCalendarIds below), never all
//     of them by default.
//  2. Nothing here ever reaches Nearby's servers. Permission state, the
//     selected-calendar-ids opt-in, and the "already handled" dismissed-
//     event-id set are all plain AsyncStorage on this device -- raw
//     calendar event data is read live from the OS and rendered directly;
//     it becomes a real Nearby record (services/occasions.js's
//     addOccasion()) only at the exact moment the user explicitly taps
//     "Save as Occasion" / "Plan Something" on one specific event.
//
// Platform.OS === 'web' guard follows this repo's own established
// convention (BusinessDashboardScreen.js's native-only-action branches) --
// the Expo web export of the business dashboard has no device calendar to
// read from at all.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';

const SELECTED_CALENDAR_IDS_KEY = 'nearby_selected_calendar_ids_v1';
const DISMISSED_EVENT_IDS_KEY = 'nearby_dismissed_calendar_event_ids_v1';

export function isCalendarIntegrationSupported() {
  return Platform.OS !== 'web';
}

export async function getCalendarPermissionStatus() {
  if (!isCalendarIntegrationSupported()) return 'unsupported';
  try {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    return status;
  } catch (e) {
    console.error('getCalendarPermissionStatus error', e);
    return 'undetermined';
  }
}

// Triggers the real native OS permission dialog. Callers should show their
// own contextual explanation first (per the user's own locked spec: "Allow
// Nearby to use selected calendar events to help you plan?") -- this
// function itself only wraps the OS-level prompt.
export async function requestCalendarPermission() {
  if (!isCalendarIntegrationSupported()) return 'unsupported';
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status;
  } catch (e) {
    console.error('requestCalendarPermission error', e);
    return 'denied';
  }
}

// Every real device calendar (Personal, Work, a shared family calendar, a
// "Birthdays" calendar, etc.) -- shown so the user can pick specifically
// which ones Nearby may read from. Never called before permission is
// already granted.
export async function listDeviceCalendars() {
  if (!isCalendarIntegrationSupported()) return [];
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return (calendars ?? [])
      .filter((c) => !!c.title)
      .map((c) => ({ id: c.id, title: c.title, color: c.color, source: c.source?.name ?? null }))
      .sort((a, b) => a.title.localeCompare(b.title));
  } catch (e) {
    console.error('listDeviceCalendars error', e);
    return [];
  }
}

export async function getSelectedCalendarIds() {
  try {
    const raw = await AsyncStorage.getItem(SELECTED_CALENDAR_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('getSelectedCalendarIds error', e);
    return [];
  }
}

export async function setSelectedCalendarIds(ids) {
  try {
    await AsyncStorage.setItem(SELECTED_CALENDAR_IDS_KEY, JSON.stringify(ids ?? []));
    return true;
  } catch (e) {
    console.error('setSelectedCalendarIds error', e);
    return false;
  }
}

// "Disconnect" -- clears Nearby's own opt-in (it stops reading), honestly
// distinct from OS-level permission (which stays granted until the user
// revokes it in their device Settings; Nearby cannot and does not revoke
// it programmatically).
export async function clearSelectedCalendarIds() {
  return setSelectedCalendarIds([]);
}

export async function getDismissedCalendarEventIds() {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_EVENT_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (e) {
    console.error('getDismissedCalendarEventIds error', e);
    return new Set();
  }
}

// Marks one specific event as already handled (saved as an Occasion, or
// explicitly dismissed as "not relevant") so it doesn't keep resurfacing.
export async function markCalendarEventHandled(eventId) {
  try {
    const current = await getDismissedCalendarEventIds();
    current.add(eventId);
    await AsyncStorage.setItem(DISMISSED_EVENT_IDS_KEY, JSON.stringify(Array.from(current)));
    return true;
  } catch (e) {
    console.error('markCalendarEventHandled error', e);
    return false;
  }
}

// True only when the OS permission is actually granted AND the user has
// explicitly picked at least one real calendar to share -- either alone is
// not enough. This is the single source of truth every other surface
// (OccasionsScreen, Surprise Me, Home) checks before reading anything.
export async function isCalendarIntegrationEnabled() {
  if (!isCalendarIntegrationSupported()) return false;
  const [status, selectedIds] = await Promise.all([getCalendarPermissionStatus(), getSelectedCalendarIds()]);
  return status === 'granted' && selectedIds.length > 0;
}

// Read-only. Only ever queries the calendars the user explicitly selected
// -- never "all calendars," even though the OS permission would technically
// allow it. Returns a plain, minimal shape (never the full native event
// object, which can carry attendees/notes/location -- more than this
// feature needs).
export async function getUpcomingCalendarEvents(withinDays = 60) {
  if (!isCalendarIntegrationSupported()) return [];
  try {
    const selectedIds = await getSelectedCalendarIds();
    if (selectedIds.length === 0) return [];
    const status = await getCalendarPermissionStatus();
    if (status !== 'granted') return [];

    const start = new Date();
    const end = new Date(start.getTime() + withinDays * 24 * 60 * 60 * 1000);
    const events = await Calendar.getEventsAsync(selectedIds, start, end);
    return (events ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      startDate: e.startDate,
      allDay: !!e.allDay,
      calendarId: e.calendarId,
    }));
  } catch (e) {
    console.error('getUpcomingCalendarEvents error', e);
    return [];
  }
}

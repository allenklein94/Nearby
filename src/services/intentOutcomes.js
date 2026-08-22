// 10/10 roadmap Part 1 (see CLAUDE.md's "10/10 roadmap" plan): the outcome
// tracking loop. Records what a resolved intent result actually led to, and
// later, honestly, whether it went well -- no fabricated numbers, a null
// outcome always means "unknown," never a default negative.
import { supabase } from './supabase';
import * as Location from 'expo-location';
import { findRecurringIntentPattern, formatSmartPlaceholder } from '../utils/intentPatterns';
import { getTimePeriod } from '../utils/timeContext';

// Same coarse-bucketing convention already established for profiles.wide_area
// and gatherings.wide_area (see the 20260823_intent_submissions_wide_area.sql
// migration comment for the reasoning) -- ~6-7 mile grid, never a precise
// coordinate.
function wideArea(latitude, longitude) {
  const bucketLat = Math.round(latitude * 10) / 10;
  const bucketLng = Math.round(longitude * 10) / 10;
  return `${bucketLat},${bucketLng}`;
}

// Never prompts -- reads only an already-granted permission's cached last
// known position, best-effort. Deliberately not a fresh
// getCurrentPositionAsync() call: this runs from inside a fire-and-forget
// analytics write, and resolveIntent() (called moments earlier for the
// gathering/unclear/community branches) has almost certainly already
// resolved and cached a fresh position for this exact submission -- forcing
// a second GPS read here would only add latency with no real benefit. A
// user who hasn't granted location permission, or has none cached yet,
// correctly gets null -- honest "unknown," matching this file's own
// "null always means unknown, never fabricated" convention.
async function bestEffortWideArea() {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const position = await Location.getLastKnownPositionAsync();
    if (!position) return null;
    return wideArea(position.coords.latitude, position.coords.longitude);
  } catch (e) {
    return null;
  }
}

// Fire-and-forget by design -- this is telemetry-shaped, not a blocking
// step in the user's own flow. Matches this codebase's established
// "failures are swallowed with a console log, same as the post-gathering
// feedback modal's philosophy" convention for non-critical writes.
export async function recordIntentSelection({ rawText, category, dateWindow, resultType, resultId, resultTitle, submissionId }) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('intent_outcomes').insert({
      user_id: user.id,
      raw_text: rawText ?? null,
      category: category ?? null,
      date_window: dateWindow ?? null,
      result_type: resultType,
      result_id: resultId ?? null,
      result_title: resultTitle ?? null,
      submission_id: submissionId ?? null,
    });
  } catch (e) {
    console.error('recordIntentSelection failed', e);
  }
}

// 10/10 roadmap Part 2: one row per real resolveIntent()/
// resolveCommunityIntent() call, successful or not -- feeds
// get_intent_funnel_stats() (admin-only). Returns the new row's id (or
// null on failure) so callers can thread it onto a later
// recordIntentSelection() call, giving the funnel a real join instead of
// an approximation across two unlinked tables.
//
// local_period fix (V2 acceptance audit, Defect B -- see
// PRODUCT_AUDIT/V2_ACCEPTANCE_REPORT_2026-08-15.md): captured here, at
// submission time, using the exact same getTimePeriod() every other
// period-aware surface in this app already uses. This is the only point
// where the user's real local wall-clock time is actually knowable --
// intent_submissions.created_at is a plain timestamptz, and Postgres has
// no way to recover which real-world local time it corresponds to after
// the fact. get_cross_user_intent_patterns() groups by this stored value
// now, not by extract()-ing the UTC-stored created_at.
export async function recordIntentSubmission({ rawText, category, dateWindow, intentKind, hadAnyResult, reachedBusinessFallback }) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const wideAreaValue = await bestEffortWideArea();
    const { data, error } = await supabase
      .from('intent_submissions')
      .insert({
        user_id: user.id,
        raw_text: rawText ?? null,
        category: category ?? null,
        date_window: dateWindow ?? null,
        intent_kind: intentKind ?? null,
        had_any_result: !!hadAnyResult,
        reached_business_fallback: !!reachedBusinessFallback,
        local_period: getTimePeriod(),
        wide_area: wideAreaValue,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (e) {
    console.error('recordIntentSubmission failed', e);
    return null;
  }
}

// The one real row eligible for a "how did it go?" prompt right now: not
// yet answered, and selected long enough ago to plausibly have already
// happened (4h -- a real, stated elapsed window, not dressed up as a
// precise science; matches this codebase's own "no invented numbers"
// convention by being honest about what it is).
const PENDING_PROMPT_WINDOW_MS = 4 * 60 * 60 * 1000;

export async function getPendingIntentOutcomePrompt() {
  const cutoff = new Date(Date.now() - PENDING_PROMPT_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('intent_outcomes')
    .select('id, result_type, result_title, selected_at')
    .is('answered_at', null)
    .lte('selected_at', cutoff)
    .order('selected_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function recordIntentOutcome(id, { outcome, wouldRepeat = null }) {
  const { error } = await supabase
    .from('intent_outcomes')
    .update({ outcome, would_repeat: wouldRepeat, answered_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// A user can dismiss without answering -- answered_at still gets stamped
// (so this row stops being re-offered), outcome stays null, honestly
// distinguishing "asked, declined to say" from "never asked."
export async function dismissIntentOutcomePrompt(id) {
  const { error } = await supabase
    .from('intent_outcomes')
    .update({ answered_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// 10/10 roadmap Part 7: Home progressive personalization. Reads the
// caller's own real intent_submissions rows (RLS already scopes this to
// "only ever my own rows," same as every table this pattern uses
// elsewhere) for a real, recurring day-of-week + time-window + category
// pattern -- never invented, never shown for a user without one. Bounded
// to the most recent 200 rows, matching this codebase's own established
// "plain .limit() cap, no pagination UI built yet" convention for a
// personal-record query like this. Fire-and-forget-shaped like the rest
// of this file -- a failure here should never block Home's own load.
export async function getMyIntentPatterns() {
  try {
    const { data, error } = await supabase
      .from('intent_submissions')
      .select('category, created_at')
      .not('category', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    const pattern = findRecurringIntentPattern(data ?? []);
    if (!pattern) return null;
    const placeholderText = formatSmartPlaceholder(pattern);
    if (!placeholderText) return null;
    return { ...pattern, placeholderText };
  } catch (e) {
    console.error('getMyIntentPatterns failed', e);
    return null;
  }
}

// Closes the "no impression/dismissal analytics for either Home nudge card"
// gap (see PRODUCT_AUDIT/V2_ACCEPTANCE_REPORT_2026-08-15.md §10 and
// CONSOLIDATED_AUDIT_2026-08-15.md's still-open list) -- fire-and-forget,
// same non-blocking convention as every other write in this file. Never
// throws into the caller; a failure here should never affect the nudge
// card's own real behavior.
export async function recordNudgeEvent(nudgeType, event, category) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('home_nudge_events').insert({
      user_id: user.id,
      nudge_type: nudgeType,
      event,
      category: category ?? null,
    });
  } catch (e) {
    console.error('recordNudgeEvent failed', e);
  }
}

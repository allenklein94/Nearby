// 10/10 roadmap Part 1 (see CLAUDE.md's "10/10 roadmap" plan): the outcome
// tracking loop. Records what a resolved intent result actually led to, and
// later, honestly, whether it went well -- no fabricated numbers, a null
// outcome always means "unknown," never a default negative.
import { supabase } from './supabase';
import { findRecurringIntentPattern, formatSmartPlaceholder } from '../utils/intentPatterns';

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
export async function recordIntentSubmission({ rawText, category, dateWindow, intentKind, hadAnyResult, reachedBusinessFallback }) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
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

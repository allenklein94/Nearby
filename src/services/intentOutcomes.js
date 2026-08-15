// 10/10 roadmap Part 1 (see CLAUDE.md's "10/10 roadmap" plan): the outcome
// tracking loop. Records what a resolved intent result actually led to, and
// later, honestly, whether it went well -- no fabricated numbers, a null
// outcome always means "unknown," never a default negative.
import { supabase } from './supabase';

// Fire-and-forget by design -- this is telemetry-shaped, not a blocking
// step in the user's own flow. Matches this codebase's established
// "failures are swallowed with a console log, same as the post-gathering
// feedback modal's philosophy" convention for non-critical writes.
export async function recordIntentSelection({ rawText, category, dateWindow, resultType, resultId, resultTitle }) {
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
    });
  } catch (e) {
    console.error('recordIntentSelection failed', e);
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

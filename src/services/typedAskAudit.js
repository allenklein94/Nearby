// Typed-ask audit writer (owner item 105). The ONE path Home and Discover use to record what a typed ask understood and showed.
// Observability only: it runs after the results are on screen, never awaits in front of them, never throws, and never touches a
// score or an order. The snapshot id is made here, synchronously, so a tap can link to it even before the write lands.
// Nothing here reads or stores the typed words (utils/typedAskAudit.js builds the payload from closed vocabularies only).
import { randomUUID } from 'expo-crypto';
import { supabase } from './supabase';
import { buildTypedAskSnapshot, displayedIntentResults } from '../utils/typedAskAudit';
import { isNeverLearnedCategory } from '../constants/neverLearned';

// `result` = the object the surface renders from: { items, experience, outcome?, submissionId, audit, classifyResult }.
// Returns { snapshotId, displayed } immediately (or null when nothing can be recorded); the write itself is fire-and-forget.
export function recordTypedAsk(surface, result) {
  try {
    if (!result || (surface !== 'home' && surface !== 'discover')) return null;
    const outcome = result.outcome ?? (Array.isArray(result.items) && result.items.length > 0 ? 'results' : 'empty');
    const displayed = displayedIntentResults(surface, { ...result, outcome });
    const snapshotId = randomUUID();
    const classify = result.classifyResult ?? {};
    // The community path has no resolver audit: it records what the classifier understood and the ids shown.
    const interpretation = {
      ...(result.audit?.interpretation ?? { category: classify.category ?? null, date_window: classify.dateWindow ?? null }),
      intent: classify.intent ?? null,
    };
    // Item 183: an ask about a never-learned category (religion) is resolved for this search only and never audited.
    if ([interpretation.category, interpretation.preferred_category, interpretation.date_tag].some(isNeverLearnedCategory)) {
      return { snapshotId: null, displayed };
    }
    const payload = buildTypedAskSnapshot({
      id: snapshotId, surface, submissionId: result.submissionId ?? null, outcome, audit: result.audit ?? null, displayed, interpretation,
      refinement: result.refinement ?? null,
    });
    Promise.resolve(supabase.rpc('record_typed_ask_snapshot', { snapshot: payload }))
      .then(({ error }) => { if (error) console.error('typed-ask audit write failed', error); })
      .catch((e) => console.error('typed-ask audit write failed', e));
    return { snapshotId, displayed };
  } catch (e) {
    console.error('typed-ask audit skipped', e);
    return null;
  }
}

// Refine a typed ask in place (owner item 107, shared by Home and Discover). ONE implementation: the chip logic is
// utils/askRefinements.js, the search is resolveClassifiedAsk (the same one both surfaces' first search uses), and the record goes
// to the typed-ask audit linked to the ORIGINAL ask's snapshot. No AI call, no new search-log row, no retyping, no navigation.
// Item 108: a Browse category tapped on Discover narrows the same ask the same way (utils/categoryNarrow.js); chips and category
// both live on the one classification, so each survives the other.
import { resolveClassifiedAsk } from './intentResolver';
import { recordTypedAsk } from './typedAskAudit';
import { applyRefinement, refinementChips } from '../utils/askRefinements';
import { toggleCategoryNarrow } from '../utils/categoryNarrow';

// Re-runs the ask with `refined` and records it against the original ask. Returns the next surface state; an empty result keeps
// the refined classification (so the chip / category stays selected and can be tapped off).
async function rerunAsk(surface, prev, refined, key, action) {
  const next = await resolveClassifiedAsk(refined, prev.typedText);
  const outcome = next.items.length > 0 ? 'results' : 'empty';
  const rootSnapshotId = prev.rootSnapshotId ?? prev.shown?.snapshotId ?? null;
  const shown = recordTypedAsk(surface, {
    ...next, outcome, classifyResult: refined, submissionId: prev.submissionId ?? null,
    refinement: { key, action, parentSnapshotId: rootSnapshotId },
  });
  return { ...prev, ...next, outcome, classifyResult: refined, shown, rootSnapshotId, refined: true };
}

// `prev` = the surface's current typed-ask state ({ classifyResult, typedText, submissionId, shown, rootSnapshotId? ... }).
export async function refineTypedAsk(surface, prev, key) {
  const wasSelected = !!refinementChips(prev.classifyResult).find((c) => c.key === key)?.selected;
  return rerunAsk(surface, prev, applyRefinement(prev.classifyResult, key), key, wasSelected ? 'removed' : 'applied');
}

// Tap a category group: narrow the ask to it, switch to another group, or (tapping the selected one) clear it.
export async function narrowTypedAsk(surface, prev, groupKey) {
  const refined = toggleCategoryNarrow(prev.classifyResult, groupKey);
  return rerunAsk(surface, prev, refined, 'category', refined.narrowGroup ? 'applied' : 'removed');
}

// Rebuilds the Discover ask state from a saved session with fresh results. Throws on a failed search (the caller keeps the
// session and offers Try again). Not recorded as a new audit snapshot: the person asked nothing new; a later refinement still
// links to the original ask, and a tap links by submission id.
export async function restoreDiscoverAsk(saved) {
  const next = await resolveClassifiedAsk(saved.classifyResult, saved.typedText);
  const outcome = next.items.length > 0 ? 'results' : 'empty';
  return {
    ...next, outcome, classifyResult: saved.classifyResult, typedText: saved.typedText, submissionId: saved.submissionId,
    rootSnapshotId: saved.rootSnapshotId, askedAt: saved.askedAt, shown: null, refined: saved.refined === true, restored: true,
  };
}

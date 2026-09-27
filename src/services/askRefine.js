// Refine a typed ask in place (owner item 107, shared by Home and Discover). ONE implementation: the chip logic is
// utils/askRefinements.js, the search is resolveClassifiedAsk (the same one both surfaces' first search uses), and the record goes
// to the typed-ask audit linked to the ORIGINAL ask's snapshot. No AI call, no new search-log row, no retyping, no navigation.
import { resolveClassifiedAsk } from './intentResolver';
import { recordTypedAsk } from './typedAskAudit';
import { applyRefinement, refinementChips } from '../utils/askRefinements';

// `prev` = the surface's current typed-ask state ({ classifyResult, typedText, submissionId, shown, rootSnapshotId? ... }).
// Returns the next state; an empty result keeps the refined classification (so the chip stays selected and can be tapped off).
export async function refineTypedAsk(surface, prev, key) {
  const wasSelected = !!refinementChips(prev.classifyResult).find((c) => c.key === key)?.selected;
  const refined = applyRefinement(prev.classifyResult, key);
  const next = await resolveClassifiedAsk(refined, prev.typedText);
  const outcome = next.items.length > 0 ? 'results' : 'empty';
  const rootSnapshotId = prev.rootSnapshotId ?? prev.shown?.snapshotId ?? null;
  const shown = recordTypedAsk(surface, {
    ...next, outcome, classifyResult: refined, submissionId: prev.submissionId ?? null,
    refinement: { key, action: wasSelected ? 'removed' : 'applied', parentSnapshotId: rootSnapshotId },
  });
  return { ...prev, ...next, outcome, classifyResult: refined, shown, rootSnapshotId, refined: true };
}

// P1 remediation (CLAUDE.md, Aug 28 2026 Full Coherence Audit, "Discover
// needs to stop throwing away information it already has"): Discover's
// own gathering cards already fetch price_level/party_type on every row
// (SAFE_GATHERING_FIELDS has carried both since the category/filter
// taxonomy pass) but never rendered either. Small, shared label maps so
// any new card-level display of these two fields can't drift from
// GatheringsScreen.js's own PRICE_FILTER_OPTIONS/PARTY_TYPE_FILTER_OPTIONS
// chip labels (kept byte-identical to those, deliberately not re-exported
// from that file to avoid touching an already-shipped filter screen's own
// local constant shape for this pass).
export const PRICE_LEVEL_LABELS = {
  free: 'Free',
  $: '$',
  $$: '$$',
  $$$: '$$$',
};

export const PARTY_TYPE_LABELS = {
  solo: '🧍 Solo-Friendly',
  friends: '👥 Bring Friends',
  groups: '👨‍👩‍👧‍👦 Big Group',
  date: '💕 A Date Idea',
};

// A real, honest, contextual signal line for a gathering card -- only the
// signals actually set render, never a fabricated "no preference" filler.
// Deliberately excludes fullness (gatheringFullness.js's own job, kept
// separate since not every card wants both on the same line).
export function gatheringSignalLine(gathering) {
  const parts = [];
  if (gathering?.price_level && PRICE_LEVEL_LABELS[gathering.price_level]) {
    parts.push(PRICE_LEVEL_LABELS[gathering.price_level]);
  }
  if (gathering?.party_type && PARTY_TYPE_LABELS[gathering.party_type]) {
    parts.push(PARTY_TYPE_LABELS[gathering.party_type]);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

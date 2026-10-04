// Perk Selection State (owner, 2026-10-04): Discover -> Perks is the one perk surface; a selected perk expands in place.
// The selected perk is always on screen: when the list being shown does not hold it (a link to a perk that the current
// search, cap or filter left out), it is shown first, so the person never has to look for it. Pure.
export function listWithSelectedPerk(list, selectedId, ...pools) {
  const shown = Array.isArray(list) ? list : [];
  if (!selectedId || shown.some((o) => o?.id === selectedId)) return shown;
  for (const pool of pools) {
    const found = (pool ?? []).find((o) => o?.id === selectedId);
    if (found) return [found, ...shown];
  }
  return shown;
}

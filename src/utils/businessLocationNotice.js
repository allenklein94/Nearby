// A business with no coordinates is skipped by every request routing rule (they are all distance-based), so it never
// receives an opportunity and never appears on the map. This says so plainly. Null = nothing to fix.
export function businessLocationNotice(partner) {
  if (!partner) return null;
  const hasCoords = partner.latitude != null && partner.longitude != null;
  if (hasCoords) return null;
  if (!partner.address) {
    return { needsAction: true, text: '📍 Add your address — until you do, nearby requests can’t reach your business' };
  }
  return { needsAction: true, text: '📍 We couldn’t place your address on the map — tap to re-enter it so nearby requests can reach you' };
}

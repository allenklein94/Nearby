// Owner edits to a "Your night" list. Pure helpers so the rules are testable and the screen stays thin.

// Stops can only be edited while the night is live (matches the server: draft/confirmed).
export function canEditNight(planStatus, isOwner) {
  return !!isOwner && (planStatus === 'draft' || planStatus === 'confirmed');
}

// A night keeps at least two stops (the server rule); a completed stop is history and cannot be removed.
export function canRemoveStop(stop, stopCount) {
  return stopCount > 2 && stop?.state !== 'done';
}

// Ordered stop ids after moving the stop at `index` by `delta` (-1 up, +1 down); null when it can't move.
export function moveStopIds(stops, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= stops.length || to < 0 || to >= stops.length) return null;
  const ids = stops.map((s) => s.id);
  [ids[index], ids[to]] = [ids[to], ids[index]];
  return ids;
}

// What removing will do, in the person's words. Only claims a cancellation when one really will happen.
export function removeStopCopy(stop) {
  const name = stop?.title || 'this stop';
  if (stop?.stopType === 'business_availability' && stop?.requestId) {
    if (stop.state === 'booked') return { title: `Remove ${name}?`, message: 'This cancels your reservation and lets the business know. The rest of your night stays as it is.', action: 'Remove and cancel' };
    if (stop.state === 'requested' || stop.state === 'offer_received') return { title: `Remove ${name}?`, message: 'This cancels your request to the business. The rest of your night stays as it is.', action: 'Remove and cancel' };
  }
  return { title: `Remove ${name}?`, message: 'It comes off your night. Nothing else changes.', action: 'Remove' };
}

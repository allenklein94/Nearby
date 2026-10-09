// The facts line on the "You're booked" card (motion/BookedCelebration.js): only what the screen really has, in order.
export function bookedDetailsLine({ businessName = null, dateLabel = null, timeLabel = null } = {}) {
  const when = [dateLabel, timeLabel].filter(Boolean).join(' · ');
  const parts = [businessName, when].filter((p) => p && String(p).trim());
  return parts.length ? parts.join(' · ') : null;
}

// Item 107 (CLAUDE.md): "Build the occasion around a beautiful shareable
// card." Pure text composition for the caption that travels alongside the
// captured card image through the native share sheet -- kept separate from
// the visual component (OccasionPlanShareCard.js) so it's directly unit-
// testable, same split as occasionPackageFormatting.js/businessRequestWhen.js
// already establish. Reuses Item 90's own buildPlanSummary() shape
// (title/dateLabel/timeLabel/location/partySize) rather than inventing a
// second "what does a finalized plan look like" model.
export function buildOccasionPlanShareCaption({ title, dateLabel, timeLabel, location, partySize } = {}) {
  const lines = [title || 'Our Plan'];
  const whenParts = [dateLabel, timeLabel].filter(Boolean);
  if (whenParts.length > 0) lines.push(whenParts.join(' · '));
  if (location) lines.push(`📍 ${location}`);
  if (partySize != null) lines.push(`👥 ${partySize} going`);
  lines.push('Planned with Nearby');
  return lines.join('\n');
}

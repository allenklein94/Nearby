import React from 'react';
import CompactRow from './CompactRow';

// A place or perk row on Discover: photo (or a tinted icon), name, one real "why now" line the calling screen already
// computed (open-now, price/rating, the perk's own named tag; never invented here) and an optional real action word.
// Drawn as Discover's compact row (design review 2026-10-10) through CompactRow; the props are unchanged.
export default function PlaceCard({
  photoUrl,
  // Only needed when photoUrl came from Google's Place Photo endpoint (an
  // iOS-app-restricted key requires this header on every request, not just
  // a browser Referer) -- curated cover photo URLs don't need it and pass
  // nothing here.
  photoHeaders,
  icon = '📍',
  title,
  reason,
  onPress,
  accessibilityLabel,
  style,
  // Phase 8 (CLAUDE.md, Discover visual hierarchy) -- optional, so every
  // existing call site (Places) keeps today's plain chevron unchanged.
  // When passed (Perks' real "Redeem"/"Redeemed ✓" state), replaces the
  // chevron with the real next-action word instead of a generic arrow.
  // actionIsState marks a completed/passive state ("Redeemed ✓") rather
  // than a live action ("Redeem") -- coral is reserved for the latter
  // (CLAUDE.md's "coral = action, not decoration" rule), so a state label
  // renders muted instead.
  actionLabel,
  actionIsState = false,
  // Optional real category color (e.g. categoryStyleFor(tag).color from a
  // caller that has one, like an offer's target_interest_tag) to tint the
  // fallback icon's background. Falls back to the neutral surfaceElevated
  // token -- never plain colors.surface -- so a photo-less row still reads
  // as a "functional card" instead of a blank white one.
  tintColor,
  accessibilityState,
}) {
  // Discover design review (2026-10-10): a compact row (round thumbnail, title, one line, hairline divider), not a white card.
  return (
    <CompactRow
      photoUrl={photoUrl}
      photoHeaders={photoHeaders}
      icon={icon}
      tintColor={tintColor}
      title={title}
      meta={reason}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? `${title}${reason ? `, ${reason}` : ''}`}
      accessibilityState={accessibilityState}
      action={actionLabel ? { label: actionLabel, isState: actionIsState } : null}
      style={style}
    />
  );
}

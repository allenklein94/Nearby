// Item 80 ("Make it special" -- CLAUDE.md). Pure, dependency-free
// readiness/state-derivation for the plan-addon rollup -- kept separate
// from the service layer (services/planAddons.js) so it stays directly
// unit-testable, mirroring intentResolverScoring.js's own split from
// intentResolver.js and occasionPackageFormatting.js's split from
// occasionPackages.js.
//
// Each add-on is its own independent business_requests row with its own
// business_request_offers -- this never mutates that lifecycle, it only
// reads it. One business declining an add-on must never affect another
// add-on's state or the primary's -- there is no shared state here to
// invalidate, only a client-side summary of what's already true.

// Reduces one add-on's business_requests row + its offers down to one of
// a small, honest set of states.
export function deriveAddonRequestState(addonRequest, offers = []) {
  if (!addonRequest) return 'none';
  if (addonRequest.status === 'cancelled') return 'skipped';
  if (addonRequest.status === 'fulfilled') return 'confirmed';
  if (addonRequest.status === 'merged') return 'confirmed';

  const hasAccepted = offers.some((o) => o.status === 'accepted' || o.status === 'completed');
  if (hasAccepted) return 'confirmed';

  if (addonRequest.status === 'expired') {
    return offers.some((o) => o.status === 'offered') ? 'expired_with_offer' : 'no_response';
  }

  // status === 'open' from here on.
  if (offers.some((o) => o.status === 'offered')) return 'offered';
  if (offers.length > 0 && offers.every((o) => o.status === 'declined' || o.status === 'withdrawn' || o.status === 'cancelled' || o.status === 'expired')) {
    return 'declined';
  }
  return 'pending';
}

const STATE_COPY = {
  none: { label: 'Not added', short: '—' },
  pending: { label: 'Waiting for a business to respond', short: '○ Waiting' },
  offered: { label: 'A business made an offer — review it', short: '○ Offer ready' },
  confirmed: { label: 'Confirmed', short: '✓ Confirmed' },
  declined: { label: "No business could help — try again or pick another", short: '⚠️ Declined' },
  no_response: { label: 'No response in time', short: '⚠️ No response' },
  expired_with_offer: { label: 'An offer expired before you responded', short: '⚠️ Offer expired' },
  skipped: { label: 'Skipped', short: '— Skipped' },
};

export function addonStateCopy(state) {
  return STATE_COPY[state] ?? STATE_COPY.none;
}

// Whether the user can start a fresh attempt at this add-on type right
// now (either nothing has ever been added, or the most recent attempt
// reached a genuine dead end). Mirrors the "retry / choose another
// business / remove the add-on" instruction -- confirmed/pending/offered
// slots are already in play and must not be silently replaced.
export function canRetryAddon(state) {
  return state === 'none' || state === 'declined' || state === 'no_response' || state === 'expired_with_offer' || state === 'skipped';
}

// One-line rollup for the whole plan, per the locked mock ("2 of 3
// extras confirmed"). Only ever counts add-ons the user actually added
// (per-type, most recent attempt) -- optional means optional, an
// occasion is never blocked from reading "Ready" just because the user
// never asked for a photographer at all.
export function summarizePlanAddonReadiness(primaryConfirmed, addonSummaries) {
  // 'skipped' (the user explicitly removed/cancelled it) is deliberately
  // excluded from the ratio -- optional means optional, and something
  // the user opted out of shouldn't read as an unmet requirement.
  const added = addonSummaries.filter((a) => a.state !== 'none' && a.state !== 'skipped');
  if (added.length === 0) {
    return primaryConfirmed ? 'Ready' : 'Waiting on your reservation';
  }
  if (!primaryConfirmed) {
    return 'Waiting on your reservation';
  }
  const confirmedCount = added.filter((a) => a.state === 'confirmed').length;
  const needsAttention = added.some((a) => a.state === 'declined' || a.state === 'no_response' || a.state === 'expired_with_offer');
  if (confirmedCount === added.length) return 'Ready — everything is confirmed';
  if (needsAttention) return `${confirmedCount} of ${added.length} extras confirmed — one needs attention`;
  return `${confirmedCount} of ${added.length} extras confirmed`;
}

// Builds the per-type summary list this screen actually renders from,
// given the relevant add-on types for this occasion and the real fetched
// rows (business_requests where parent_request_id = this plan's primary,
// each with its own offers array already embedded). When a type has more
// than one historical attempt (a retry after cancelling/declining), the
// most recently created row is the one shown.
export function summarizeAddonsByType(addonTypes, addonRequestsWithOffers) {
  return addonTypes.map((type) => {
    const attempts = addonRequestsWithOffers
      .filter((r) => r.addon_type === type.key)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const latest = attempts[0] ?? null;
    const state = latest ? deriveAddonRequestState(latest, latest.business_request_offers ?? []) : 'none';
    return {
      key: type.key,
      label: type.label,
      icon: type.icon,
      requestId: latest?.id ?? null,
      state,
      canRetry: canRetryAddon(state),
    };
  });
}

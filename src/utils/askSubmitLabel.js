// The AskBusiness Send button names who REALLY receives the request (owner idea "384"), read by sight and by screen reader alike.
// Verified against the live server (2026-10-24): create_business_request and create_business_request_for_gathering send a request
// with target_partner_id ONLY to that business (_route_request_to_partner, notifiedCount 1); without it they fan out to every
// eligible nearby business. A posting alone (matchedAvailability / preferred_availability_id) does NOT narrow the fan-out; a target
// + its own posting (the deliberate Reserve / Book / Request, migration 20270342) reaches that business alone with the posting's
// terms or is refused. The match and community paths take no target. So "Ask {name}" only when a target is sent.
import { tr } from '../i18n/translate';

export function askRecipient({ targetPartner = null, matchId = null, communityId = null } = {}) {
  if (targetPartner?.id && targetPartner?.name && !matchId && !communityId) return { kind: 'one', name: targetPartner.name };
  return { kind: 'nearby' };
}

// One label for the button text AND its accessibilityLabel.
export function askSubmitLabel(ctx) {
  const r = askRecipient(ctx);
  return r.kind === 'one' ? tr('ui.askBusiness.ask', { name: r.name }) : tr('ui.askBusiness.askNearbyBusinesses');
}

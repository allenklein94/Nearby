import { canRespondToOpportunity } from './objectLifecycle';
import { isOfferExpired } from './objectState';
import { countLabel } from './plural';
import { offerPriceLabel } from './outcomeDisplay';

// Business Home "what can I act on right now" strip (owner item 41). Every figure is a count of the owner's own real
// rows: new = opportunities they can still respond to; active offers = offers they sent that the customer has not
// answered and that have not run past valid_until; confirmed = accepted offers. "This month" is the server's own
// billing estimate (the platform fee, itemized elsewhere) -- absent or unknown means the part is not shown, never $0.
export function dashboardGlance(opportunities, owed, now = new Date()) {
  const list = opportunities ?? [];
  const newCount = list.filter((o) => canRespondToOpportunity(o)).length;
  const activeOffers = list.filter((o) => o.status === 'offered' && !isOfferExpired(o, now)).length;
  const confirmed = list.filter((o) => o.status === 'accepted').length;

  const today = [
    { key: 'new', text: `${newCount} new ${newCount === 1 ? 'opportunity' : 'opportunities'}`, section: 'requests', count: newCount },
    { key: 'offers', text: `${activeOffers} active ${activeOffers === 1 ? 'offer' : 'offers'}`, section: 'requests', count: activeOffers },
    { key: 'confirmed', text: `${confirmed} confirmed`, section: 'bookings', count: confirmed },
  ];

  const month = [];
  if (owed && owed.redemptionCount != null && Number.isFinite(Number(owed.redemptionCount))) {
    month.push({ key: 'redemptions', text: countLabel(Number(owed.redemptionCount), 'redemption') });
    const amount = owed.billingModel && owed.billingModel !== 'custom' ? offerPriceLabel(owed.estimatedAmount) : null;
    if (amount) month.push({ key: 'estimate', text: `${amount} estimated` });
  }
  return { today, month };
}

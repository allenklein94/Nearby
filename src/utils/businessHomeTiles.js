import { tr } from '../i18n/translate';
import { isPipelineNew, isPipelineOffered, reviewingRequestIds } from './businessPipeline';
import { offerFunnelView } from './offerFunnel';

// Item 36 (owner, 2026-10-08): business Home is the SUMMARY of summary -> collection -> entity -> action. Three tiles, each
// one tap into its collection; the rich opportunity card (item 40, LOCKED) stays the entity + action surface, and Send
// Offer opens the existing offer flow. No new screen.
//
//   Opportunities = still-answerable requests (the pipeline's New stage)         -> Opportunities tab
//   Offers        = offers waiting on the customer (the pipeline's Offered stage) -> Opportunities tab
//   Performance   = this month's funnel (sent, accepted, redeemed) + "Value of offers redeemed" when a priced redemption
//                   exists                                                        -> Offer Performance (More tools)
//
// Counts read the SAME predicates as the pipeline (utils/businessPipeline.js), so Home and the tab can never disagree.
// Nothing is shown before the source loaded (opportunitiesLoaded / a loaded funnel), so a zero is a real zero. Never
// "revenue" or customer spend (item 205): the value is the business's own offer prices on redeemed offers.
export function businessHomeTiles({ opportunities, submissions = [], loaded, funnel, value, now = new Date() }) {
  const tiles = [];
  if (loaded === true) {
    const list = opportunities ?? [];
    const reviewing = reviewingRequestIds(submissions);
    const fresh = list.filter((o) => isPipelineNew(o, reviewing, now)).length;
    const pending = list.filter((o) => isPipelineOffered(o, now)).length;
    tiles.push({ key: 'opportunities', title: tr('ui.bizDash1.tiles.opportunities'), line: tr('ui.bizDash1.tiles.newRequests', { count: fresh }), count: fresh, target: 'opportunities', highlight: fresh > 0 });
    tiles.push({ key: 'offers', title: tr('ui.bizDash1.tiles.offers'), line: tr('ui.bizDash1.tiles.pendingOffers', { count: pending }), count: pending, target: 'opportunities', highlight: false });
  }
  const f = offerFunnelView(funnel, value);
  if (f) {
    const by = Object.fromEntries(f.stages.map((s) => [s.key, s.count]));
    tiles.push({
      key: 'performance',
      title: tr('ui.bizDash1.tiles.performance'),
      line: tr('ui.bizDash1.tiles.funnelLine', { sent: by.offersSent, accepted: by.accepted, redeemed: by.redemptions }),
      valueLine: f.valueRow ? `${f.valueRow.label}: ${f.valueRow.amount}` : null,
      target: 'performance',
      highlight: false,
    });
  }
  return tiles;
}

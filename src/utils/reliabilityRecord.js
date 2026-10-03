// The ONE reliability rule (owner item 162 reuses "Our pick"): a business has an ESTABLISHED record once
// get_partner_offer_reputation counts at least RELIABILITY_MIN_OPPORTUNITIES opportunities. Used by the consumer offers list
// ("Our pick" + its ordering, BusinessRequestDetailScreen) and by need asks (utils/needAsk.js). No new data, score or learning.
export const RELIABILITY_MIN_OPPORTUNITIES = 5;

export function hasEstablishedRecord(rep) {
  return !!rep && Number(rep.total_opportunities) >= RELIABILITY_MIN_OPPORTUNITIES;
}

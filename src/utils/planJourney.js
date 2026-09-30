// The Occasion -> People -> Activity -> Business -> Offer -> Reservation chain, derived only from a normalized
import { tr } from '../i18n/translate';
// get_plan_overview response (services/plans.js normalizePlanOverview). Every step is a real fact or an honest "not yet".
// A budget line from real captured numbers only; the unit (total vs per person) isn't recorded, so none is claimed.
// A stored request or reservation status as a word in the person's language (unknown values shown as stored). Separate
// word lists per object so gendered languages can agree with the noun.
const STATUS_WORDS = { request: ['open', 'fulfilled', 'expired', 'cancelled', 'merged'], reservation: ['requested', 'confirmed', 'failed', 'cancelled'] };
export function statusWord(status, kind) {
  return STATUS_WORDS[kind]?.includes(status) ? tr(`ui.planDetail.${kind}Word.${status}`) : status;
}

export function formatBudget(min, max) {
  const lo = min == null ? null : Number(min);
  const hi = max == null ? null : Number(max);
  if (lo != null && hi != null) return lo === hi ? `$${hi}` : `$${lo}–$${hi}`;
  if (hi != null) return tr('ui.planDetail.upTo', { hi: hi });
  if (lo != null) return tr('ui.planDetail.from', { lo: lo });
  return null;
}

export function buildPlanJourney(overview) {
  if (!overview) return [];
  const { plan, who, activity, businessRequest, offers, reservation, lifecycle } = overview;
  const people = (who.participants?.length || 0) + (who.organizers?.length || 0) + (who.guestCount || 0) + (who.attendeeCount || 0);
  const acceptedOffer = (offers || []).find((o) => o.accepted_at);
  return [
    {
      key: 'people',
      label: tr('ui.planDetail.people'),
      done: people > 0,
      detail: people > 0 ? tr('ui.planDetail.peopleInvolved', { count: people }) : tr('ui.planDetail.justYouSoFar'),
    },
    {
      key: 'activity',
      label: tr('ui.planDetail.activity'),
      done: !!activity,
      detail: activity ? activity.title : tr('ui.planDetail.notDecidedYet'),
    },
    {
      key: 'budget',
      label: tr('ui.planDetail.budget'),
      done: formatBudget(plan?.budget_min, plan?.budget_max) != null,
      detail: formatBudget(plan?.budget_min, plan?.budget_max) || tr('ui.planDetail.noBudgetSet'),
    },
    {
      key: 'business',
      label: tr('ui.planDetail.business'),
      done: !!businessRequest,
      detail: businessRequest ? tr('ui.planDetail.request', { status: statusWord(businessRequest.status, 'request') }) : tr('ui.planDetail.noBusinessInvolvedYet'),
    },
    {
      key: 'offer',
      label: tr('ui.planDetail.offer'),
      done: !!lifecycle.hasOffer,
      detail: acceptedOffer
        ? (acceptedOffer.business_name ? tr('ui.planDetail.acceptedFrom', { name: acceptedOffer.business_name }) : tr('ui.planDetail.accepted'))
        : lifecycle.hasOffer ? tr('ui.planDetail.offersReceived', { count: offers.length }) : tr('ui.planDetail.noOffersYet'),
    },
    {
      key: 'reservation',
      label: tr('ui.planDetail.reservation2'),
      done: !!reservation && reservation.status === 'confirmed',
      detail: reservation ? tr('ui.planDetail.reservation3', { status: statusWord(reservation.status, 'reservation') }) : tr('ui.planDetail.notBookedYet'),
    },
  ];
}

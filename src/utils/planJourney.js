// The Occasion -> People -> Activity -> Business -> Offer -> Reservation chain, derived only from a normalized
// get_plan_overview response (services/plans.js normalizePlanOverview). Every step is a real fact or an honest "not yet".
export function buildPlanJourney(overview) {
  if (!overview) return [];
  const { who, activity, businessRequest, offers, reservation, lifecycle } = overview;
  const people = (who.participants?.length || 0) + (who.organizers?.length || 0) + (who.guestCount || 0);
  const acceptedOffer = (offers || []).find((o) => o.accepted_at);
  return [
    {
      key: 'people',
      label: 'People',
      done: people > 0,
      detail: people > 0 ? `${people} ${people === 1 ? 'person' : 'people'} involved` : 'Just you so far',
    },
    {
      key: 'activity',
      label: 'Activity',
      done: !!activity,
      detail: activity ? activity.title : 'Not decided yet',
    },
    {
      key: 'business',
      label: 'Business',
      done: !!businessRequest,
      detail: businessRequest ? `Request ${businessRequest.status}` : 'No business involved yet',
    },
    {
      key: 'offer',
      label: 'Offer',
      done: !!lifecycle.hasOffer,
      detail: acceptedOffer
        ? `Accepted${acceptedOffer.business_name ? ` from ${acceptedOffer.business_name}` : ''}`
        : lifecycle.hasOffer ? `${offers.length} received` : 'No offers yet',
    },
    {
      key: 'reservation',
      label: 'Reservation',
      done: !!reservation && reservation.status === 'confirmed',
      detail: reservation ? `Reservation ${reservation.status}` : 'Not booked yet',
    },
  ];
}

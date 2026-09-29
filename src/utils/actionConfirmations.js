// Owner item 123 (2026-09-27): every important action confirms WHAT happened, never a bare "Success!". One home for the
// wording so each surface says the same thing. Each returns [title, message] for showSuccessToast (message may be null).
// Consumer confirmations read ui.actions (11 languages); the business-side ones stay English (business experience).
// Business replies are named by their real kind (item 121): plain availability is never called an offer.
import { businessReplyKind } from './offerCopy';
import { tr } from '../i18n/translate';

export function replySentConfirmation(offer) {
  switch (businessReplyKind(offer)) {
    case 'alternative': return ['New time suggested', 'The customer will see the time you suggested.'];
    case 'offer': return ['Offer sent', 'The customer can accept it now.'];
    default: return ['Reply sent', 'The customer will see you can take them.'];
  }
}

// The full offer editor saves the offer and checks it in the background (item 83); it is not sent yet.
export const OFFER_QUEUED_CONFIRMATION = ['Offer saved', "We're checking it now. It goes to the customer as soon as it clears."];

export function inviteSentConfirmation(name) {
  return [name ? tr('ui.actions.invitationSentTo', { name }) : tr('ui.actions.invitationSent'), null];
}

// Interested is private (item 37): it only changes what THIS person hears about the gathering.
export function interestedConfirmation(on) {
  return on
    ? [tr('ui.actions.savedInterested'), tr('ui.actions.savedInterestedBody')]
    : [tr('ui.actions.removedInterested'), null];
}

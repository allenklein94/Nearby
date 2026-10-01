// Owner item 123 (2026-09-27): every important action confirms WHAT happened, never a bare "Success!". One home for the
// wording so each surface says the same thing. Each returns [title, message] for showSuccessToast (message may be null).
// Consumer confirmations read ui.actions, business-side ones ui.bizHelp.confirm (11 languages each; English = the locked copy).
// Business replies are named by their real kind (item 121): plain availability is never called an offer.
import { businessReplyKind } from './offerCopy';
import { tr } from '../i18n/translate';

export function replySentConfirmation(offer) {
  switch (businessReplyKind(offer)) {
    case 'alternative': return [tr('ui.bizHelp.confirm.altTitle'), tr('ui.bizHelp.confirm.altBody')];
    case 'offer': return [tr('ui.bizHelp.confirm.offerTitle'), tr('ui.bizHelp.confirm.offerBody')];
    default: return [tr('ui.bizHelp.confirm.replyTitle'), tr('ui.bizHelp.confirm.replyBody')];
  }
}

// The full offer editor saves the offer and checks it in the background (item 83); it is not sent yet.
// A getter so the wording follows the current language (read at the moment it is shown).
export const offerQueuedConfirmation = () => [tr('ui.bizHelp.confirm.queuedTitle'), tr('ui.bizHelp.confirm.queuedBody')];

export function inviteSentConfirmation(name) {
  return [name ? tr('ui.actions.invitationSentTo', { name }) : tr('ui.actions.invitationSent'), null];
}

// Interested is private (item 37): it only changes what THIS person hears about the gathering.
export function interestedConfirmation(on) {
  return on
    ? [tr('ui.actions.savedInterested'), tr('ui.actions.savedInterestedBody')]
    : [tr('ui.actions.removedInterested'), null];
}

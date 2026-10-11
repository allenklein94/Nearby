// Owner item 43 (2026-10-11): "Create something could have a formation animation". When a gathering is published, the pieces
// the host just made -- what, when, who, where -- settle into one card under "Your gathering is live!", then the card glows
// once (motion/GatheringFormation.js). This is the ONE place that decides which pieces exist and what each says.
//
// The rules (owner rule 2026-10-11, motion amplifies correct data):
//   - Only real pieces. What and when come from the STORED gathering (the row the server returned), never the form.
//     Who is the stored visibility (who can join), plus the real invite result when invites were sent at publish.
//     Where follows the Create review step's own rule (the line the host just confirmed): the picked place's name, else
//     "Custom location set" for a dropped pin, else "Your current location" (the gathering stores coordinates only).
//   - A piece with nothing real behind it is left out; the moment animates only what exists.
//   - The headline keeps its existing words ("Your gathering is live!"), never "Your plan is ready": nobody has accepted
//     yet, so "ready" would claim more than publishing did.
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { visibilityMeta } from '../constants/gatheringVisibility';

export const FORMATION_ORDER = ['what', 'when', 'who', 'where'];

// t: the screen's translate; whenLabel: displayGatheringWhen(gathering, language) (the one when engine), passed in so this stays pure.
export function formationPieces({ gathering, whenLabel = null, placeName = null, customLocation = false, preInviteResult = null, communityName = null, t }) {
  if (!gathering?.id || typeof t !== 'function') return [];
  const pieces = [];
  const title = String(gathering.title ?? '').trim();
  if (title) pieces.push({ key: 'what', icon: categoryStyleFor(gathering.interest_tag).icon, text: title });
  if (whenLabel && String(whenLabel).trim()) pieces.push({ key: 'when', icon: '🕐', text: whenLabel });
  const vis = visibilityMeta(gathering.visibility);
  if (vis) {
    const label = t(`ui.gatheringVocab.visibility.${vis.key}.label`);
    const who = vis.key === 'community' && communityName ? `${label} — ${communityName}` : label;
    const invited = preInviteResult && preInviteResult.total > 0
      ? t('ui.gatheringConfirmation.weInvited', { sent: preInviteResult.sent, count: preInviteResult.total })
      : null;
    pieces.push({ key: 'who', icon: vis.icon, text: who, note: invited });
  }
  const place = String(placeName ?? '').trim();
  if (place) pieces.push({ key: 'where', icon: '📍', text: place });
  else pieces.push({ key: 'where', icon: '📍', text: t(customLocation ? 'ui.gatheringForm.preview.customLocation' : 'ui.gatheringForm.currentLocation') });
  return pieces;
}

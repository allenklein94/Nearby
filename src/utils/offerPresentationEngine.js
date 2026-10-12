// The Offer Presentation Engine (owner item 21, 2026-10-11). ONE function decides how a business reply is presented,
// so no screen custom-codes an offer and the motion can improve later without touching the marketplace:
//
//   offer data + business brand assets + offer type + consumer context
//        -> presentOffer()
//        -> which card (waiting / open / closed / booked / visited), rendered as
//             static        a reply already seen, the owner's Customer Preview, a closed reply, Reduce Motion
//             animated      a newly received open reply builds itself in (components/OfferAssembly.js)
//             confirmation  the accepted card (motion/OfferAcceptedMorph.js, plays once right after the person's own tap)
//           with its media as an image, a tap-to-play video (only with a screened poster) or a "Video attached" label.
//
// It composes the existing single sources and adds no rule of its own: the reply kind (utils/offerCopy.js, item 121),
// the assembly steps + once-per-new-reply decision (utils/offerAssembly.js), the booking state (utils/acceptedBooking.js,
// item 12), the lifecycle (utils/objectLifecycle.js), the discount headline (utils/offerPresentation.js, item 11) and the
// redeem instructions (utils/offerMedia.js).
//
// Fairness (item 17, LOCKED): every business replying to the same request gets the same structure; presentation follows
// only the content the reply carries. Brand assets are limited to the business's name and its screened logo. Nothing here
// may read payment, sponsorship, ranking or plan fields (guard: utils/offerPresentationEngine.test.js); consumer context
// changes only timing and wording (first-ever reply, just accepted, Reduce Motion, owner preview), never prominence.
import { businessReplyKind, businessReplyStatus, heardLine } from './offerCopy';
import { assemblySteps, shouldAssemble } from './offerAssembly';
import { acceptedBookingState, ACCEPTED_TITLE_KEY } from './acceptedBooking';
import { offerLifecycleState } from './objectLifecycle';
import { discountHeadlinePct, offerCountdown } from './offerPresentation';
import { visibleRedemption } from './offerMedia';
import { tr } from '../i18n/translate';

export const OFFER_CARDS = ['waiting', 'open', 'closed', 'booked', 'visited'];
export const OFFER_RENDERINGS = ['static', 'animated', 'confirmation'];
export const OFFER_MEDIA_KINDS = ['image', 'video', 'video_label'];

const KNOWN_STATUS = new Set(['pending', 'offered', 'accepted', 'declined', 'withdrawn', 'expired', 'cancelled', 'completed']);

// The reply's photo/video. A video plays (tap-to-play, muted) only with a screened poster; an older unscreened video is an
// honest "Video attached" label. No media = null.
export function offerMediaView(offer) {
  const path = offer?.media_path ?? null;
  if (!path) return null;
  if (offer.media_type === 'video') {
    return offer.media_poster_path ? { kind: 'video', path, posterPath: offer.media_poster_path } : { kind: 'video_label', path };
  }
  return { kind: 'image', path };
}

// Which card this reply is, from its stored state.
export function offerCard(offer, now = new Date()) {
  const state = offerLifecycleState(offer, now);
  if (state === 'pending') return 'waiting';
  if (state === 'offered') return 'open';
  if (state === 'accepted') return 'booked';
  if (state === 'completed') return 'visited';
  return 'closed';
}

// The status line under the business: what the reply said while open (item 121), else its real outcome.
function statusLine(offer, card, now) {
  if (card === 'booked' || card === 'visited') return null; // the confirmation heading says it
  if (card === 'open') return businessReplyStatus(offer);
  if (offerLifecycleState(offer, now) === 'expired') return tr('ui.requestDetail.thisOfferHasExpired');
  return KNOWN_STATUS.has(offer?.status) ? tr(`ui.requestDetail.offerStatus.${offer.status}`) : (offer?.status ?? null);
}

// Whether a reply builds itself in right now (the animated card). OfferAssembly reads this one decision.
export function assemblesNow(offer, context = {}) {
  return presentOffer(offer, { context }).rendering === 'animated';
}

export function presentOffer(offer, { business = {}, context = {} } = {}) {
  const {
    viewer = 'customer', // 'customer' | 'owner_preview'
    reduceMotion = false,
    now = new Date(),
    isFirstEverReply = false,
    isFirstRedemption = false, // item 52: this is the person's earliest-ever completed offer (services fetchFirstRedemptionId)
    justAccepted = false,
    playedIds,
  } = context;
  const preview = viewer === 'owner_preview';
  // The owner's preview is always the open reply the customer would receive.
  const card = preview ? 'open' : offerCard(offer, now);
  const accepted = card === 'booked' || card === 'visited';
  const animated = !preview && card === 'open'
    && shouldAssemble(offer, playedIds ? { reduceMotion, now, playedIds } : { reduceMotion, now });
  const bookingState = accepted ? acceptedBookingState(offer) : null;
  const media = offerMediaView(offer);

  return {
    card,
    rendering: accepted ? 'confirmation' : animated ? 'animated' : 'static',
    replyKind: businessReplyKind(offer),
    business: { name: business.name ?? null, logoUri: business.logoUri ?? null },
    media,
    heard: card === 'open' ? heardLine(!preview && isFirstEverReply) : null,
    statusLine: preview ? businessReplyStatus(offer) : statusLine(offer, card, now),
    steps: card === 'open' ? assemblySteps(offer) : [],
    discountPct: discountHeadlinePct(offer),
    // Item 47: the last-30-minutes countdown, only on an open reply (a booked or closed one no longer runs out).
    countdown: card === 'open' ? offerCountdown(offer, now) : null,
    confirmation: bookingState ? {
      state: bookingState,
      titleKey: ACCEPTED_TITLE_KEY[bookingState],
      booked: bookingState === 'booked',
      warn: bookingState === 'not_through',
      plays: !preview && justAccepted, // the morph itself settles at once under Reduce Motion
      visitConfirmed: card === 'visited',
      // Item 52: the first-ever redemption says once what just happened (words only, under "✓ Visit confirmed").
      firstVisitNote: card === 'visited' && !preview && isFirstRedemption === true ? tr('ui.requestDetail.firstVisitNote') : null,
    } : null,
    redemption: card === 'booked' ? visibleRedemption(offer) : null,
  };
}

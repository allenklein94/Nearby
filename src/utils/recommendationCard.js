// Standard recommendation-card hierarchy (owner item 46, 2026-09-20). Every recommendation card is read in one glance
// as the same six fields, in this order:
//   WHAT         Coffee gathering
//   WHY          Because you like Coffee
//   WHEN/WHERE   1.2 mi · Today · 6:30 PM       (distance first, per item 33)
//   SOCIAL PROOF Sam is going
//   ACTION       I'm Interested
// A card need not carry every field: `fields` lists exactly which are available so a renderer shows those and nothing
// else. Each field is built from real data only (rules 2/7); a missing signal is an absent field, never a placeholder.
// Shared context layer (2026-09-28): WHY, WHEN/WHERE, ACTION and the tap `destination` all come from the ONE context object
// (utils/recommendationContext.js); this model only adds the social-proof split and the card's field order.
//
// SOCIAL PROOF is limited to what the viewer may already see: an accepted friend going or hosting. It is deliberately
// NOT "N people are interested" -- Interested (`gathering_interested`) is private, so no person's Interested state is
// ever shown to another viewer. A bare attendee count is a fact about the event, not social proof, and stays in the meta line.
import { recommendationFacts } from './recommendationFacts';
import { recommendationContext, contextItem } from './recommendationContext';
import { localizeReasons } from './reasonLocalization';
import { strongestReasons } from '../constants/signalPriority';
import { validReasons } from './recommendationContext';

export const CARD_FIELD_ORDER = ['what', 'why', 'meta', 'social', 'action'];
const SOCIAL_KINDS = ['going', 'friend'];

// signals: [{ kind, text }] from mergeHomeGatheringSignals (optional). Without them WHY is the facts helper's reason
// and there is no social proof line.
export function gatheringCardModel(g, { signals = null, myUserId = null, now = Date.now(), actionOpts = {}, language } = {}) {
  if (!g) return { what: null, why: null, meta: null, social: null, action: null, destination: null, entity: null, reasons: [], fields: [] };
  const list = Array.isArray(signals) ? signals : null;
  const allWhy = list ? validReasons({ reasons: list.filter((s) => !SOCIAL_KINDS.includes(s.kind)).map((s) => s.text) }) : [recommendationFacts(g).why].filter(Boolean);
  const allSocial = list ? list.filter((s) => SOCIAL_KINDS.includes(s.kind)).map((s) => s.text) : [];
  // item 194: WHY and SOCIAL PROOF together show at most the two strongest reasons, then each keeps its own line
  const shown = strongestReasons([...allWhy, ...allSocial]);
  const whyParts = allWhy.filter((t) => shown.includes(t));
  const socialParts = allSocial.filter((t) => shown.includes(t));
  const c = recommendationContext(contextItem('gathering', g, { reasons: whyParts }), { myUserId, now: new Date(now), actionOpts, language });
  const model = {
    what: g.title || null,
    why: c.reasons.join(' · ') || null,
    meta: c.context,
    social: localizeReasons(socialParts, language).join(' · ') || null,
    action: c.action,
  };
  return { ...model, destination: c.destination, entity: c.entity, reasons: c.reasons, fields: CARD_FIELD_ORDER.filter((f) => model[f]) };
}

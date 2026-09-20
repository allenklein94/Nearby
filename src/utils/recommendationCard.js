// Standard recommendation-card hierarchy (owner item 46, 2026-09-20). Every recommendation card is read in one glance
// as the same six fields, in this order:
//   WHAT         Coffee gathering
//   WHY          Because you like Coffee
//   WHEN/WHERE   1.2 mi · Today · 6:30 PM       (distance first, per item 33)
//   SOCIAL PROOF Sam is going
//   ACTION       I'm Interested
// A card need not carry every field: `fields` lists exactly which are available so a renderer shows those and nothing
// else. Each field is built from real data only (rules 2/7); a missing signal is an absent field, never a placeholder.
//
// SOCIAL PROOF is limited to what the viewer may already see: an accepted friend going or hosting. It is deliberately
// NOT "N people are interested" -- Interested (`gathering_interested`) is private, so no person's Interested state is
// ever shown to another viewer. A bare attendee count is a fact about the event, not social proof, and stays in the meta line.
import { recommendationFacts } from './recommendationFacts';
import { gatheringPrimaryAction } from './primaryAction';

export const CARD_FIELD_ORDER = ['what', 'why', 'meta', 'social', 'action'];
const SOCIAL_KINDS = ['going', 'friend'];

// signals: [{ kind, text }] from mergeHomeGatheringSignals (optional). Without them WHY is the facts helper's reason
// and there is no social proof line.
export function gatheringCardModel(g, { signals = null, myUserId = null, now = Date.now(), actionOpts = {} } = {}) {
  if (!g) return { what: null, why: null, meta: null, social: null, action: null, fields: [] };
  const facts = recommendationFacts(g);
  const list = Array.isArray(signals) ? signals : null;
  const whyParts = list ? list.filter((s) => !SOCIAL_KINDS.includes(s.kind)).map((s) => s.text) : [facts.why].filter(Boolean);
  const socialParts = list ? list.filter((s) => SOCIAL_KINDS.includes(s.kind)).map((s) => s.text) : [];
  const model = {
    what: g.title || null,
    why: whyParts.join(' · ') || null,
    meta: facts.meta,
    social: socialParts.join(' · ') || null,
    action: g.id ? gatheringPrimaryAction(g, myUserId, now, actionOpts) : null,
  };
  return { ...model, fields: CARD_FIELD_ORDER.filter((f) => model[f]) };
}

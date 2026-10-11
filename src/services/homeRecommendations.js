// Phase 1 of the "Build everything" plan (CLAUDE.md, Aug 22 2026) — the
// unified Home recommendation engine. A pure, dependency-free scoring
// function (no I/O, matching intentResolverScoring.js's own established
// "testable in isolation" shape) that reuses the SAME shared scoring axis
// the intent resolver already proved out across 5 candidate types
// (SCORE_INTEREST_MATCH/SCORE_CLOSE_DISTANCE/SCORE_HAPPENING_NOW/
// SCORE_OWN_NETWORK) — deliberately not a new invented scale. Every point
// awarded has a real, itemized reason attached; nothing here is an opaque
// machine-learned weight, matching this file's oldest and most
// consistently-enforced rule (see CLAUDE.md's own repeated "no premature
// universal/AI-driven matching algorithm" constraint).
import { groupKeyForTag } from '../constants/interestGraph';
import { BROAD_GROUP_POINTS } from '../constants/blendedRanking';
import { comfortFits } from '../constants/socialComfort';
import { SCORE_INTEREST_MATCH, SCORE_CLOSE_DISTANCE, SCORE_HAPPENING_NOW, SCORE_OWN_NETWORK } from './intentResolverScoring';
import { gatheringEnvironment } from '../constants/environmentMatch';
import { gatheringWeatherWindow } from '../utils/weatherWindow';
import { businessWeatherAdjustment } from '../utils/weatherBias';
// P1 item 4 (CLAUDE.md, Aug 28 Full Coherence Audit): shared, canonical
// reason text -- closes a real, confirmed duplication where these exact
// weather strings were independently re-typed, verbatim, in
// intentResolver.js's own resolveGatherings() (see that file's own
// weatherBonus block).
import { REASON_TEXT, becauseYouLikeReason, reasonText } from '../constants/recommendationReasonVocabulary';
// Phase J (CLAUDE.md, Sep 3 2026 audit finding 8 / locked "Phase J" text) --
// the real signal-source-priority-by-maturity model. Every bonus below is
// tagged with its real provenance class; weightSignal() only ever scales
// the BEHAVIORAL/SOCIAL/TRANSACTIONAL classes, and only once a real
// maturity number is actually supplied by the caller (HomeScreen.js) --
// see that file's own call site for how accountAgeDays/hasBehavioralHistory
// are computed from data this screen already has in scope, zero new
// queries. EXPLICIT/CONTEXTUAL are structurally never dampened by
// weightSignal() itself, so tagging them here is documentation, not a
// behavior lever.
import { SIGNAL_SOURCES, computeAccountMaturity, weightSignal } from '../constants/signalSourceMaturity';
import { feedbackFor, feedbackWeight } from '../utils/experienceFeedback';

// Item 131 audit: this is the CANDIDATE pool, not what Home shows. Home's attention list (utils/homeAttention.js) picks and
// caps at MAX_HOME_ATTENTION by the shared tier ladder; a cut here at 5 let this file's point total decide which candidates the
// ladder ever saw (a second ranking). The point order now only breaks ties and feeds the first-run card's top two.
export const MAX_HOME_RECOMMENDATIONS = 20;

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// The real weather-context bonus/penalty this phase actually adds beyond
// what the intent resolver already scores — reuses SCORE_HAPPENING_NOW's
// own weight (matching this file's "reuse an existing weight, don't
// invent a new number" convention) rather than a fresh constant. Only
// ever applied to a category this app can honestly classify as indoor or
// outdoor (constants/gatheringIndoorOutdoor.js's own deliberately
// conservative map) — a genuinely ambiguous category (Sports, Music,
// Fitness, ...) never gets a weather-driven bonus either way.
//
// Since 2026-09-20 the weather is judged AT the gathering's own start time
// (utils/weatherWindow.js) from forecast-block facts, not from a single
// right-now label; an unknown forecast or uncovered time is no nudge.
function weatherAdjustment(gathering, weather, scheduledAt) {
  const env = gatheringEnvironment(gathering);
  // Judged at the gathering's own start time (utils/weatherWindow.js); no
  // covering forecast block / unknown forecast = no nudge.
  const w = gatheringWeatherWindow(weather, scheduledAt);
  if (!w) return null;
  if (w.bias === 'indoor' && env === 'indoor') {
    return { points: SCORE_HAPPENING_NOW, reason: REASON_TEXT.WEATHER_GOOD_INDOOR.text };
  }
  if (w.bias === 'outdoor' && env === 'outdoor') {
    // Ordinary good weather ranks outdoor plans up silently (no reason line on every card); the reason is spoken only when
    // the weather is exceptional (item 62).
    return { points: SCORE_HAPPENING_NOW, reason: w.exceptional ? REASON_TEXT.WEATHER_GOOD_OUTDOOR.text : null };
  }
  return null;
}

// Sep 3 2026 ("global onboarding -> product wiring" master plan,
// CLAUDE.md, Phase A) -- the other real, confirmed orphaned onboarding
// field: social_comfort_level ('one_on_one'/'small_groups'/
// 'large_gatherings'/'open', OnboardingQuestionsScreen.js) was written to
// the profile at signup and, before this pass, never read by anything
// downstream. It's a categorical self-report; gatherings' own real
// group_size_feel is a 1-5 numeric vibe scale (EditGatheringScreen.js,
// "Intimate" <-> "Big group") -- not the same shape, so this is a real,
// honest range mapping between the two, not a fabricated match. 'open'
// ("I'm open to anything") deliberately earns no bonus either way -- it's
// a real answer, just one with nothing to bias toward. A gathering with
// no group_size_feel set at all is never penalized or credited -- absence
// of data is never used against (or for) a candidate, matching this
// file's own repeated convention.
function socialComfortBonus(groupSizeFeel, socialComfortLevel) {
  return comfortFits(groupSizeFeel, socialComfortLevel)
    ? { points: SCORE_INTEREST_MATCH, reason: reasonText('hangOutStyle') }
    : null;
}

function scoreGathering(gathering, weather, feedback, socialComfortLevel, maturity, interestGroups = []) {
  let score = 0;
  const reasons = [];

  if (gathering.matchesYourInterests) {
    // EXPLICIT: profiles.interests is a direct self-report -- always full
    // weight, weightSignal() never dampens this class.
    score += weightSignal(SCORE_INTEREST_MATCH, SIGNAL_SOURCES.EXPLICIT, maturity);
    if (gathering.interest_tag) reasons.push(becauseYouLikeReason(gathering.interest_tag));
  } else if (interestGroups.length > 0 && interestGroups.includes(groupKeyForTag(gathering.interest_tag))) {
    // EXPLICIT but broad: a group picked without specific tags -- a weaker match than a declared tag, never a stand-in for one.
    score += weightSignal(BROAD_GROUP_POINTS, SIGNAL_SOURCES.EXPLICIT, maturity);
    reasons.push(reasonText('inCategoryYouLike'));
  }
  if (gathering.distanceMiles !== null && gathering.distanceMiles !== undefined && gathering.distanceMiles < 2) {
    // CONTEXTUAL: a fact about the world (how far away this is), not
    // about the caller's own history -- always full weight.
    score += weightSignal(SCORE_CLOSE_DISTANCE, SIGNAL_SOURCES.CONTEXTUAL, maturity);
    // Deliberately not getGatheringFitReasons()'s own more specific
    // distanceLabel -- this function never has a formatted distance
    // string in scope, only the raw distanceMiles number, so "Close by"
    // stays its own real, honest (if less specific) DISTANCE reason.
    reasons.push(reasonText('closeBy'));
  }
  if (isToday(gathering.scheduled_at)) {
    // CONTEXTUAL: today's real date, always full weight.
    score += weightSignal(SCORE_HAPPENING_NOW, SIGNAL_SOURCES.CONTEXTUAL, maturity);
    reasons.push(REASON_TEXT.HAPPENING_TODAY.text);
  }
  const weatherBonus = weatherAdjustment(gathering, weather, gathering.scheduled_at);
  if (weatherBonus) {
    // CONTEXTUAL: today's real weather, always full weight.
    score += weightSignal(weatherBonus.points, SIGNAL_SOURCES.CONTEXTUAL, maturity);
    if (weatherBonus.reason) reasons.push(weatherBonus.reason);
  }
  // Item 35 (owner, 2026-10-11): the person's latest "How was it?" word (utils/experienceFeedback.js, the one reader). A loved
  // host (or business) lifts by the own-network weight, a loved kind by the interest weight; Not for me lowers by the same,
  // without a reason line. Most specific wins, never stacked. Scaled by account maturity (feedbackWeight, TRANSACTIONAL): one
  // early rating from a new account must not carry full weight (owner, 2026-10-11).
  const fb = feedbackFor({ hostId: gathering.host_id, partnerId: gathering.hosting_partner_id, category: gathering.interest_tag }, feedback);
  if (fb.direction !== 0) {
    score += fb.direction * feedbackWeight(maturity, fb.scope === 'kind' ? SCORE_INTEREST_MATCH : SCORE_OWN_NETWORK);
    if (fb.reason) reasons.push(fb.reason);
  }
  const comfortBonus = socialComfortBonus(gathering.group_size_feel, socialComfortLevel);
  if (comfortBonus) {
    // EXPLICIT: social_comfort_level is a direct onboarding self-report --
    // always full weight.
    score += weightSignal(comfortBonus.points, SIGNAL_SOURCES.EXPLICIT, maturity);
    reasons.push(comfortBonus.reason);
  }

  return { score, reasons };
}

function scoreOffer(offer, feedback, maturity, weather = null) {
  let score = 0;
  const reasons = [];

  // getActiveOffers() already only ever returns an untargeted offer, or a
  // targeted one whose target_interest_tag genuinely matches the
  // caller's own real interests — so any offer reaching this function at
  // all is already a real, honest match; a targeted one just gets to say
  // so explicitly. EXPLICIT: validated against the caller's own real
  // interests -- always full weight.
  if (offer.target_interest_tag) {
    score += weightSignal(SCORE_INTEREST_MATCH, SIGNAL_SOURCES.EXPLICIT, maturity);
    reasons.push(becauseYouLikeReason(offer.target_interest_tag));
  }
  if (offer.brand_partners?.name) {
    reasons.push(reasonText('atBusiness', { business: offer.brand_partners.name }));
  }
  // Item 35: the same feedback reader as scoreGathering (a loved / Not for me business, else the offer's kind).
  const fb = feedbackFor({ partnerId: offer.partner_id, category: offer.target_interest_tag ?? offer.brand_partners?.category ?? null }, feedback);
  if (fb.direction !== 0) {
    score += fb.direction * feedbackWeight(maturity, fb.scope === 'kind' ? SCORE_INTEREST_MATCH : SCORE_OWN_NETWORK);
    if (fb.reason) reasons.push(fb.reason);
  }

  // A business's own indoor/outdoor/weather-dependent declaration against today's weather (item 63). Ranks, never hides,
  // and adds no reason line (weather stays a quiet signal, item 62). CONTEXTUAL like the gathering weather bonus.
  const weatherPoints = businessWeatherAdjustment(offer.brand_partners?.weather_setting, weather, SCORE_HAPPENING_NOW);
  if (weatherPoints !== 0) score += weightSignal(weatherPoints, SIGNAL_SOURCES.CONTEXTUAL, maturity);

  return { score, reasons };
}

// context: { gatherings=[], offers=[], weather=null, excludeIds=Set(),
// feedback=null (item 35, getMyExperienceFeedback), accountAgeDays=null,
// hasBehavioralHistory=false }
// accountAgeDays/hasBehavioralHistory are both optional and both default
// to values that resolve to full trust (computeAccountMaturity() returns
// 1 when accountAgeDays is null) -- an existing caller that doesn't pass
// either sees byte-identical scores to before Phase J, matching this
// file's own "an omitted optional param must never change existing
// behavior" convention.
// Returns up to MAX_HOME_RECOMMENDATIONS items, highest score first, each
// carrying every real reason it earned that score — never a bare number
// with no explanation attached.
export function buildHomeRecommendations({
  gatherings = [],
  offers = [],
  weather = null,
  excludeIds = new Set(),
  feedback = null,
  socialComfortLevel = null,
  interestGroups = [],
  accountAgeDays = null,
  hasBehavioralHistory = false,
} = {}) {
  const candidates = [];
  const maturity = computeAccountMaturity({ accountAgeDays, hasBehavioralHistory });

  for (const gathering of gatherings) {
    if (excludeIds.has(gathering.id)) continue;
    const { score, reasons } = scoreGathering(gathering, weather, feedback, socialComfortLevel, maturity, interestGroups);
    if (reasons.length === 0) continue;
    candidates.push({ type: 'gathering', id: gathering.id, title: gathering.title, reasons, score, data: gathering });
  }

  for (const offer of offers) {
    if (excludeIds.has(offer.id)) continue;
    const { score, reasons } = scoreOffer(offer, feedback, maturity, weather);
    if (reasons.length === 0) continue;
    candidates.push({ type: 'perk', id: offer.id, title: offer.title, reasons, score, data: offer });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, MAX_HOME_RECOMMENDATIONS);
}

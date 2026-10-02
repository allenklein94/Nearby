import { recordSearchBehavior } from './behaviorSignals';
import { openDestination } from './openDestination';
import * as Location from 'expo-location';
import { getNearbyGatherings, getGatheringFitReasons } from './gatherings';
import { getMyCommunities, getPublicCommunities } from './communities';
import { getActiveOffers, logBusinessProfileView, getPartnerWeatherSettings, getPartnerPriceInfo, getPartnerSuitedAges, getPartnerOperatingInfo, getDeclinedBusinesses } from './brandOffers';
import { bookingModeOf } from '../constants/bookingMode';
import { BUSINESS_RESULT_TYPES } from '../utils/businessAction';
import { intentResultDestination } from '../utils/recommendationContext';
import { askedForReason, occasionOfferedReason, resultNoteText, resultTitleText } from '../constants/recommendationReasonVocabulary';
import { openNowAskFromText, candidateEntity, openNowLift, OPEN_NOW_CAPTION } from '../utils/operatingStatus';
import { applyBusinessPriceToCandidates } from '../utils/priceBias';
import { vibesFromAsk, applyVibeSinks, applyQualityDepth, frameDatePlaces, isDateAsk, datePartySize, dateFrame } from '../constants/businessVibes';
import { canonicalGroupForTag } from '../constants/categoryMapping';
import { applyAskWeather } from '../utils/askWeather';
import { gatheringEnvironment, businessEnvironment } from '../constants/environmentMatch';
import { categoryEnvironment } from '../constants/gatheringIndoorOutdoor';
import { occasionLabel } from '../constants/businessAttributes';
import { getConnectedOpenBusinessRequests, searchActiveBusinessAvailability, searchPolicyOnlyBusinesses, searchOccasionOfferingBusinesses, getMyBusinessAffinitySignals } from './businessFulfillment';
import { getWhoForPreferenceSignals } from './preferencePolls';
import { searchOccasionPackages, formatOccasionPackageDetail } from './occasionPackages';
import { getSocialForecast } from './homeDashboard';
import { classifyCreateRequest } from './createAssistant';
import { recordIntentSubmission } from './intentOutcomes';
import { pickForMeKind } from './surpriseMeLogic';
import { assembleExperience } from './experienceAssembly';
// P1 item 4 (CLAUDE.md, Aug 28 Full Coherence Audit): the identical
// shared, canonical weather-reason text homeRecommendations.js's own
// weatherAdjustment() uses -- closes a real, confirmed duplication where
// this file independently re-typed the same two strings verbatim.
import { REASON_TEXT } from '../constants/recommendationReasonVocabulary';
// 10/10 roadmap Part 8: these five pure helpers used to be defined
// locally in this file -- moved verbatim (no behavior change) to
// intentResolverScoring.js so they're directly unit-testable without
// dragging in this file's own I/O-touching imports above. See that
// file's own header comment for the full reasoning.
import {
  SCORE_INTEREST_MATCH,
  SCORE_CLOSE_DISTANCE,
  SCORE_OWN_NETWORK,
  SCORE_HAPPENING_NOW,
  SCORE_CONFIRMED_AVAILABILITY_FLOOR,
  extractMeaningfulWords,
  titleMentionBonus,
  matchesDateWindow,
  dateWindowToDateRange,
  scoreGatheringForResolver,
  gatheringResolverScoreParts,
  priceAndPartyBonus,
  attributeAndCuisineBonus,
  hobbyAttributeBonus,
  activityFitBonus,
  SCORE_ACTIVITY_FIT,
  accommodatesPartyTypeBonus,
  occasionBonus,
  occasionOfferingScore,
  dedupeBusinessTiers,
  subcategoryBonus,
  secondaryCategoryBonus,
  favoriteBusinessBonus,
  pastPlanBonus,
  whoForPreferenceBonus,
  getBusinessAvailabilityReasons,
  detectFriendDiscoveryIntent,
  SCORE_OCCASION_PACKAGE_FLOOR,
} from './intentResolverScoring';
import { activitiesFromText, gatheringActivityFit } from '../constants/activityLayer';
import { energiesFromText, applyEnergyToCandidates } from '../constants/energyLevel';
import { sessionIntentFromText, applySessionIntent } from '../constants/sessionIntent';
import { askedChildAges, applySuitedAgesToCandidates } from '../utils/suitedAges';
import { dietaryFromAsk, applyDietaryToCandidates } from '../constants/dietaryOptions';
import { cleanFeatures } from '../utils/gatheringPractical';
import { applyDeclaredFeatures } from '../constants/declaredFeatures';
import { parseAskFacets, askFacetsLift, askFacetsCaption, partnerPartyType, attributesFromAsk } from '../constants/askFacets';
import { isPreferredCategory, PREFERRED_CATEGORY_POINTS } from '../utils/askPreferences';
import { createScoreTrace, createRankLedger, guardTrace } from '../utils/typedAskAudit';
import { compareRanked, typedAskRankVector } from '../constants/signalPriority';
import { commitmentAsk, applyCommitmentToCandidates } from '../constants/commitmentLevel';
import { formatsFromText, applyFormatToCandidates } from '../constants/activityFormat';
import { skillLevelsFromText, applySkillToCandidates } from '../constants/skillLevel';
import { wordsBackedAttributes, applyCapabilitiesToCandidates, applyLikelyGroupToCandidates, likelyGroupFromAsk } from '../constants/businessCapabilities';
import { restrictionAsk } from '../constants/businessRestrictions';
import { genresFromText, applyGenreToCandidates } from '../constants/genreMatch';
import { timeBudgetFromText, applyTimeBudgetToCandidates, timeBudgetCaption } from '../constants/timeBudget';
import { clockWindowFromText, dateAnchorFromText, applyClockWindowToCandidates, clockWindowCaption, windowSpan, clockLabel } from '../constants/clockWindow';
import { fitExperienceToTime } from '../utils/planTiming';
import { intensityFromText, effortFromText, applyIntensityToCandidates, applyEffortToCandidates, energiesWithoutIntensity } from '../constants/intensityEffort';
import { socialSignalsFromText, applySocialToCandidates } from '../constants/socialContext';
import { distanceWillingnessFromText, applyDistanceWillingness, distanceWillingnessCaption, travelSearchMiles } from '../constants/distanceWillingness';
import { transportModeFromText, applyTransportMode, transportModeCaption, candidateKey } from '../constants/transportMode';
import { applyLearnedProximity, learnedProximityApplies } from '../utils/learnedProximity';
import { getMyLearnedProximity } from './learnedProximity';
import { getTravelTimes } from './travelTime';
import { spontaneityOf, isImmediate, applySpontaneityToCandidates, spontaneityCaption } from '../constants/spontaneity';
import { getUserLocation } from './userLocation';
import { moneyLabel } from '../utils/outcomeDisplay';
import { attendeeTotal, isGatheringFull, peopleGoing } from '../utils/gatheringFullness';
import { planAsk, occasionFromAsk, planCaption } from '../utils/planAsk';
import { recognizeCombination } from '../constants/planCombinations';
import { openEndedAskGroups, openEndedLift, openEndedCaption } from '../utils/openEndedAsk';
import { runAskEligibility } from '../utils/askEligibility';
import { isCategoryGroup } from '../utils/categoryNarrow';

const RESULT_CAP = 4;

// weatherPromise is no longer read here: weather is applied after dedupe (utils/askWeather.js), judged at each gathering's own
// start time. The parameter stays so the call site is unchanged.
// A result's score as NAMED parts (the ranking framework reads their tiers, constants/signalPriority.js; the typed-ask audit
// records them). score is always their sum.
function scored(parts) {
  const baseSignals = parts.filter((p) => p.delta);
  return { score: baseSignals.reduce((n, p) => n + p.delta, 0), baseSignals };
}

async function resolveGatherings(category, dateWindow, rawText, priceLevel, partyType, weatherPromise = null, travel = false) {
  const nearby = await getNearbyGatherings(travel ? 'travel' : 'wide');
  const relevant = nearby.filter((g) => {
    if (category && g.interest_tag !== category) return false;
    return matchesDateWindow(g.scheduled_at, dateWindow);
  });
  const meaningfulWords = extractMeaningfulWords(rawText);
  const askedActivities = activitiesFromText(rawText);
  return relevant.map((gathering) => {
    const { reasons: fitReasons } = getGatheringFitReasons(gathering);
    // item 132: the asked activity reaches gatherings too (same table and weight as businesses, from host-declared facts)
    const activityHit = gatheringActivityFit(gathering, askedActivities);
    // the explanation layer: what the ask wants to DO, then the category it named (every gathering here is in it), then fit reasons.
    // Never an occasion reason: a gathering has no occasion.
    const reasons = [activityHit?.reason, category && gathering.interest_tag === category ? askedForReason(category) : null, ...fitReasons].filter(Boolean);
    // Universal Signal Remediation Pass, P0 item 1 (CLAUDE.md, Aug 28 2026):
    // capacity/approvedAttendees are already fetched by getNearbyGatherings()
    // -- this was a pure mapping omission, not a missing query. A full
    // gathering is never hidden (it can still be the single best match, and
    // a waitlist spot can open), but the caller can now render an honest
    // "Full -- Join Waitlist" state on the result card itself instead of
    // only discovering it one screen later on GatheringDetailScreen.
    const attendeeCount = attendeeTotal(gathering);
    const isFull = isGatheringFull(gathering, attendeeCount);
    // Weather is applied after dedupe by utils/askWeather.js, judged at this gathering's own start (not today's conditions).
    return {
      type: 'gathering',
      id: gathering.id,
      title: gathering.title,
      // Matches GatheringDetailScreen's own established "🔒 Full —
      // N/M spots taken" copy, not a new visual language invented here.
      // item 135: every real reason, for the context object's `reason` (utils/recommendationContext.js)
      reasons,
      subtitle: isFull ? resultNoteText('fullWaitlistCount', { going: peopleGoing(gathering, attendeeCount), capacity: gathering.capacity }) : (reasons[0] ?? null),
      // Intent engine vision -- Experiences assembly, extended to gatherings
      // (2026-09-10): the gathering's own real interest_tag, carried onto
      // the candidate itself the same way resolveBusinessAvailability
      // already carries row.category -- so experienceAssembly.js can bucket
      // a real gathering into a template component (e.g. a live-music
      // gathering filling "Something to Do") without a second fetch.
      category: gathering.interest_tag ?? null,
      capacity: gathering.capacity ?? null,
      // the real measured distance, read by the distance-willingness pass (constants/distanceWillingness.js)
      distanceMiles: gathering.distanceMiles ?? null,
      // host-declared social facts the social-context pass compares a typed ask against (constants/socialContext.js; nothing new stored)
      partyType: gathering.party_type ?? null,
      groupSizeFeel: gathering.group_size_feel ?? null,
      // real host-declared facts the energy / commitment / spontaneity passes read (constants/energyLevel|commitmentLevel|spontaneity.js)
      startsAt: gathering.scheduled_at ?? null,
      durationMinutes: gathering.duration_minutes ?? null,
      format: gathering.format ?? null,
      skillLevel: gathering.skill_level ?? null,
      // the HOST-DECLARED genre only (music gatherings); read by the genre pass (constants/genreMatch.js), never inferred
      genre: gathering.genre ?? null,
      effortLevel: gathering.effort_level ?? null,
      requiresApproval: gathering.requires_approval === true,
      hostEnergy: gathering.energy_level ?? null,
      features: cleanFeatures(gathering.features),
      ageMin: gathering.suited_age_min ?? null,
      ageMax: gathering.suited_age_max ?? null,
      priceLevel: gathering.price_level ?? null,
      attendeeCount,
      isFull,
      // item 114: the part of the score that comes from the PERSON (a declared interest), not the ask (constants/sessionIntent.js)
      historyScore: gatheringResolverScoreParts(gathering).filter((p) => p.code === 'base_interest_match').reduce((n, p) => n + p.delta, 0),
      // scoreGatheringForResolver's parts, the title and price/party bonuses, and the asked category (every gathering here was
      // filtered to it, so it carries the same category credit a matching business or perk does)
      ...scored([
        ...gatheringResolverScoreParts(gathering),
        { code: 'base_category_match', delta: category && gathering.interest_tag === category ? SCORE_INTEREST_MATCH : 0 },
        // a real upcoming gathering with room can actually happen: the same availability credit a live business posting earns
        // (a full one only offers a waitlist spot)
        { code: 'base_availability', delta: isFull ? 0 : SCORE_CONFIRMED_AVAILABILITY_FLOOR },
        { code: 'base_title_mention', delta: titleMentionBonus(gathering.title, meaningfulWords) },
        // an explicit friends plan is preferred over a merely compatible gathering (same tier, one more point)
        { code: 'base_activity_fit', delta: activityHit ? SCORE_ACTIVITY_FIT + (activityHit.explicit ? 1 : 0) : 0 },
        { code: 'base_price_party', delta: priceAndPartyBonus(gathering, priceLevel, partyType) },
      ]),
    };
  });
}

// Communities have no scheduled date/urgency signal the way a gathering
// does, so with no detected category there's no real signal that any
// particular community the caller belongs to is relevant to this specific
// ask -- unlike gatherings (which still have date/distance/attendance to
// rank by), an uncategorized "all your communities" result would be noise,
// not a real match. Gated on a real category instead of surfaced broadly.
//
// Phase 3's Community Area integration (CLAUDE.md): a community with a
// real Community Area set gets a real, honest distance/locality signal
// folded on top of its existing score -- reusing the same
// SCORE_CLOSE_DISTANCE weight every other close-distance signal in this
// resolver already uses, not a new invented scale. A community with no
// Area set is treated exactly as before (no bonus, never a gate) -- it
// still surfaces purely on category/membership. Prefers the coarse map
// point when set (a real haversine check against the caller's own
// location, same location object already resolved once in resolveIntent);
// falls back to a plain city-name match against the caller's own
// reverse-geocoded city when no map point exists. Never inferred from
// free text -- both signals come from the caller's own real device
// location, the same source every other location-aware branch here uses.
function communityAreaBonus(c, location, myCity) {
  if (location && c.area_lat != null && c.area_lng != null) {
    const milesPerDegreeLat = 69;
    const milesPerDegreeLng = 69 * Math.cos((location.latitude * Math.PI) / 180);
    const dLat = (location.latitude - c.area_lat) * milesPerDegreeLat;
    const dLng = (location.longitude - c.area_lng) * milesPerDegreeLng;
    const distanceMiles = Math.sqrt(dLat * dLat + dLng * dLng);
    // Coarser threshold than a gathering's precise-coordinate 2-mile
    // check -- a Community Area is deliberately city-level, not a venue.
    return distanceMiles < 25 ? SCORE_CLOSE_DISTANCE : 0;
  }
  if (myCity && c.area_city && myCity.toLowerCase() === c.area_city.toLowerCase()) {
    return SCORE_CLOSE_DISTANCE;
  }
  return 0;
}

async function resolveCommunities(category, location, myCity) {
  if (!category) return [];
  const mine = await getMyCommunities();
  return mine
    .filter((c) => c.interest_tag === category && c.status === 'active')
    .map((c) => ({
      type: 'community',
      id: c.id,
      title: c.name,
      subtitle: "You're already a member",
      ...scored([
        { code: 'base_own_network', delta: SCORE_OWN_NETWORK },
        { code: 'base_category_match', delta: SCORE_INTEREST_MATCH },
        { code: 'base_area', delta: communityAreaBonus(c, location, myCity) },
      ]),
    }));
}

// Product-critique follow-through, Aug 14 2026 (CLAUDE.md's "skeptical
// first-time-user critique" section, recommendation 2): a real, confirmed
// logic bug, not just UX polish -- a `community`-classified intent
// ("I want to start a run club") previously skipped the resolver
// entirely and went straight to creation, never checking whether a
// matching community already exists, even one the caller already belongs
// to. `resolveCommunities()` above only ever answers "am I already in
// one" (used as Tier 2 of the *gathering*-shaped resolveIntent() below) --
// this is the community-intent's own counterpart, answering "does one
// exist at all," checking both the caller's own communities (reusing
// getMyCommunities()) and public communities the caller hasn't joined yet
// (getPublicCommunities(), same already-established 200-row cap, filtered
// client-side by category -- no new query shape). Gated on a real
// category, same reasoning as resolveCommunities() above -- an
// uncategorized "browse everything public" result would be noise, not a
// real match; a null category here (rare -- the classifier normally
// assigns one for a community-shaped ask) correctly returns no results,
// which HomeScreen.js then treats the same as "checked, found nothing" --
// proceeds straight to creation, not a fabricated match.
export async function resolveCommunityIntent({ category, rawText }) {
  if (!category) return [];
  const meaningfulWords = extractMeaningfulWords(rawText);

  const [mineResult, publicResult] = await Promise.allSettled([
    getMyCommunities(),
    getPublicCommunities(),
  ]);
  const mine = mineResult.status === 'fulfilled' ? mineResult.value : [];
  const myIds = new Set(mine.map((c) => c.id));

  const joined = mine
    .filter((c) => c.interest_tag === category && c.status === 'active')
    .map((c) => ({
      type: 'community',
      id: c.id,
      title: c.name,
      subtitle: "You're already a member",
      score: SCORE_OWN_NETWORK + titleMentionBonus(c.name, meaningfulWords),
    }));

  const discoverable = (publicResult.status === 'fulfilled' ? publicResult.value : [])
    .filter((c) => c.interest_tag === category && !myIds.has(c.id))
    .map((c) => ({
      type: 'community',
      id: c.id,
      title: c.name,
      subtitle: 'A public community — not yet joined',
      score: SCORE_INTEREST_MATCH + titleMentionBonus(c.name, meaningfulWords),
    }));

  return [...joined, ...discoverable].sort(compareRanked).slice(0, RESULT_CAP);
}

async function resolveConnectedRequests(category, dateWindow) {
  const { start, end } = dateWindowToDateRange(dateWindow);
  const connected = await getConnectedOpenBusinessRequests({
    category: category ?? null,
    dateStart: start,
    dateEnd: end,
  });
  return connected.map((r) => ({
    type: 'friend_request',
    id: r.id,
    userId: r.requester_id,
    title: r.requester_display_name ? resultTitleText('friendAlsoLooking', { name: r.requester_display_name }) : resultTitleText('aFriendAlsoLooking'),
    subtitle: r.raw_text,
    // Product-critique follow-through, Aug 14 2026 (recommendation 3):
    // a plain accepted friendship has no messages/matches row behind it
    // at all -- only a real dating match does -- so Message is only ever
    // offered when the RPC's own match_id genuinely resolves to one, not
    // assumed just because this is a "connected" result.
    matchId: r.match_id ?? null,
    // the server filtered these to the asked category when there is one
    ...scored([
      { code: 'base_own_network', delta: SCORE_OWN_NETWORK },
      { code: 'base_category_match', delta: category ? SCORE_INTEREST_MATCH : 0 },
    ]),
  }));
}

async function resolvePerks(category, location) {
  if (!location) return [];
  const offers = await getActiveOffers(location.latitude, location.longitude);
  const relevant = category ? offers.filter((o) => !o.target_interest_tag || o.target_interest_tag === category) : offers;
  return relevant.map((offer) => ({
    type: 'perk',
    id: offer.id,
    // C2 (CLAUDE.md's "connect existing consumer-intent + business systems"
    // plan): already fetched on every raw offer row (getActiveOffers()'s
    // own select('*', ...) includes it) -- just wasn't carried through
    // onto this mapped result before. Lets HomeScreen log a real
    // 'intent_match' business_profile_views row when this result is
    // tapped, without a second query.
    partnerId: offer.partner_id,
    // Carried so assembleExperience() can attach this perk to the SAME business's item, exact-tag match only.
    targetTag: offer.target_interest_tag ?? null,
    title: offer.title,
    subtitle: offer.brand_partners?.name ?? null,
    // A perk with no target_interest_tag is visible to everyone (no real
    // match signal); one that's actually targeted at this category is a
    // real, comparable match, same weight as a gathering's own interest
    // match.
    ...scored([{ code: 'base_category_match', delta: offer.target_interest_tag && offer.target_interest_tag === category ? SCORE_INTEREST_MATCH : 0 }]),
    // a perk explicitly targeted at the category the ask named says so; an untargeted perk gets no reason (none to name)
    reasons: offer.target_interest_tag && offer.target_interest_tag === category ? [askedForReason(category)] : [],
    // read by the open-now resolver (utils/operatingStatus.js): expiry and the perk's own time-of-day window
    expiresAt: offer.expires_at ?? null,
    validFromTime: offer.valid_from_time ?? null,
    validToTime: offer.valid_to_time ?? null,
  }));
}

// Real, live business supply -- a business already declared these terms
// in advance (Phase 4's "proactive availability"), so unlike the Tier 4
// fallback below, this is genuinely queryable right now, not something
// that requires submitting a fresh ask and waiting. This is what makes
// the business path a real candidate instead of a dead end -- see the
// integration audit for the gap this closes.
async function resolveBusinessAvailability(category, location, attributes, cuisine, partySize, partyType, occasion, affinitySignalsPromise, whoForSignalsPromise, whoForName, askedActivities = [], searchMiles = undefined) {
  if (!location) return [];
  // Universal Signal Remediation Pass, P0 item 2 (CLAUDE.md, Aug 28 2026):
  // a real hard feasibility filter now, not just relevance -- a posting
  // whose real remaining capacity can't fit the requester's own real
  // party size is excluded server-side entirely, never merely ranked
  // lower. partySize is already resolved once at the top of
  // resolveIntent() and passed to every branch that needs it, same as
  // category/location.
  const [rows, affinitySignals, whoForSignals] = await Promise.all([
    searchActiveBusinessAvailability({
      category: category ?? null,
      latitude: location.latitude,
      longitude: location.longitude,
      partySize: partySize ?? null,
      // a posting still only reaches as far as its own business chose (the RPC uses least(this, the posting's radius))
      ...(searchMiles ? { radiusMiles: searchMiles } : {}),
    }),
    affinitySignalsPromise,
    whoForSignalsPromise,
  ]);
  return rows.map((row) => {
    // Each bonus is a named part (constants/signalPriority.js TYPED_ASK_SIGNAL_TIER decides its tier); the history of the
    // comments for each lives in intentResolverScoring.js beside the bonus itself.
    const { score, baseSignals } = scored([
      // only a TARGETED posting matching the asked category is a real category match
      { code: 'base_category_match', delta: category && row.category && row.category === category ? SCORE_INTEREST_MATCH : 0 },
      { code: 'base_close_distance', delta: row.distance_miles != null && row.distance_miles < 2 ? SCORE_CLOSE_DISTANCE : 0 },
      // P0 item 3: a live posting is, by construction, available now AND confirmed (the RPC requires ends_at > now())
      { code: 'base_availability', delta: SCORE_CONFIRMED_AVAILABILITY_FLOOR },
      { code: 'base_attribute_match', delta: attributeAndCuisineBonus(row, attributes, cuisine) },
      { code: 'base_hobby_link', delta: hobbyAttributeBonus(row, affinitySignals?.declaredInterests) },
      // Activity (item 37): what the person asked to DO, against what this business declared it supports.
      { code: 'base_activity_fit', delta: activityFitBonus(row, askedActivities) },
      { code: 'base_party_type_fit', delta: accommodatesPartyTypeBonus(row, partyType, partySize) },
      { code: 'base_occasion_fit', delta: occasionBonus(row, occasion) },
      { code: 'base_subcategory', delta: subcategoryBonus(row, category) },
      { code: 'base_secondary_category', delta: secondaryCategoryBonus(row, category) },
      // a real past transaction and a standing follow (who the person usually is)
      { code: 'base_past_plan', delta: pastPlanBonus(row, affinitySignals?.pastPartnerIds) },
      { code: 'base_followed', delta: favoriteBusinessBonus(row, affinitySignals?.followedPartnerIds) },
      // Item 100: a real signal about the person the ask is FOR, not the caller
      { code: 'base_who_for', delta: whoForPreferenceBonus(row, whoForSignals) },
    ]);
    // Thursday plan item 23: real "why" text for the same bonuses just
    // scored above, never a second computation -- appended to the
    // existing title/price subtitle rather than replacing it, so no
    // information already shown here is lost.
    const bonusReasons = getBusinessAvailabilityReasons(row, {
      category, attributes, cuisine, partyType, occasion,
      followedPartnerIds: affinitySignals?.followedPartnerIds,
      pastPartnerIds: affinitySignals?.pastPartnerIds,
      declaredInterests: affinitySignals?.declaredInterests,
      whoForSignals, whoForName, askedActivities,
    });
    const baseSubtitle = row.price != null ? `${row.title} · ${moneyLabel(row.price)}` : row.title;
    // item 114: the part of the score that comes from the PERSON's history, not the ask (constants/sessionIntent.js)
    const historyScore = hobbyAttributeBonus(row, affinitySignals?.declaredInterests)
      + pastPlanBonus(row, affinitySignals?.pastPartnerIds) + favoriteBusinessBonus(row, affinitySignals?.followedPartnerIds);
    return {
      type: 'business_availability',
      historyScore,
      id: row.id,
      partnerId: row.partner_id,
      // the posting's live window, read by the open-now resolver (named apart from a gathering's startsAt on purpose)
      postingStartsAt: row.starts_at ?? null,
      postingEndsAt: row.ends_at ?? null,
      distanceMiles: row.distance_miles ?? null,
      title: resultTitleText('hasAvailability', { business: row.partner_name }),
      subtitle: bonusReasons[0] ? `${baseSubtitle} · ${bonusReasons[0]}` : baseSubtitle,
      reasons: bonusReasons,
      // Intent engine vision -- Experiences assembly, first increment
      // (2026-09-10): the row's own real category/subcategory/categories,
      // carried onto the candidate itself (not just used internally for
      // scoring above) so assembleExperience() (experienceAssembly.js) can
      // bucket this candidate into a template component without a second
      // fetch -- a pure client-side regrouping of this same already-scored
      // candidate list, same shape as HomeScreen's own groupIntentResultsByType().
      category: row.category ?? null,
      subcategory: row.subcategory ?? null,
      categories: row.categories ?? [],
      // Business-side Experience Bundles (2026-09-10, direct user request):
      // the business's own explicit self-declaration that this ONE posting
      // covers multiple components of this exact occasion's template by
      // itself -- read by assembleExperience() (experienceAssembly.js) to
      // present it as a single "one business has your whole night covered"
      // unit instead of competing for just one component slot.
      bundleOccasion: row.bundle_occasion ?? null,
      bundleComponents: row.bundle_components ?? [],
      matchedAvailability: {
        // Finding 5 fix (CLAUDE.md): the specific business_availability row
        // itself -- threaded through AskBusinessScreen's submit call so this
        // exact posting is really bound, not just re-derived from scratch.
        availabilityId: row.id,
        partnerName: row.partner_name,
        title: row.title,
        description: row.description,
        offerType: row.offer_type,
        price: row.price,
        // Taxonomy audit Phase 2 (CLAUDE.md, Aug 25 2026): informational
        // only, same as the rest of this banner -- lets the "already
        // available" banner honestly show what the posting itself carries.
        attributes: row.attributes ?? [],
        cuisine: row.cuisine ?? null,
        // P0 item 2: now genuinely returned by the RPC -- honest, real
        // remaining capacity, never guessed. null means "no fixed cap set,"
        // matching this schema's own "null = unlimited" convention.
        remainingCapacity: row.remaining_capacity ?? null,
      },
      score,
      baseSignals,
    };
  });
}

// The weaker, second tier of business supply -- a standing Offer System
// fulfillment policy (CLAUDE.md, Aug 23 2026 decision) rather than a
// business's own manually-posted live availability. Deliberately never
// scored with SCORE_HAPPENING_NOW the way resolveBusinessAvailability
// always is above -- a policy is a real, standing capability, not a
// confirmed live slot, so on the shared score axis it can never outrank a
// genuinely confirmed posting for the same real estate. Any partner that
// also has a live availability match gets de-duped out of this tier
// entirely in resolveIntent() below, so the same business is never shown
// twice at two confidence levels.
async function resolvePolicyOnlyBusinesses(location, partySize, searchMiles = undefined) {
  if (!location) return [];
  const rows = await searchPolicyOnlyBusinesses({
    latitude: location.latitude,
    longitude: location.longitude,
    partySize: partySize ?? null,
    ...(searchMiles ? { radiusMiles: searchMiles } : {}),
  });
  return rows.map((row) => ({
    type: 'business_policy_match',
    id: row.partner_id,
    partnerId: row.partner_id,
    distanceMiles: row.distance_miles ?? null,
    title: resultTitleText('mayHelp', { business: row.partner_name }),
    // Exact wording per direct instruction: never "Available" -- this is a
    // standing willingness, not confirmed inventory.
    subtitle: resultNoteText('mayBeAvailable'),
    ...scored([{ code: 'base_close_distance', delta: row.distance_miles != null && row.distance_miles < 2 ? SCORE_CLOSE_DISTANCE : 0 }]),
  }));
}

// "Occasions we offer" (20270102): a business that EXPLICITLY offers the ask's occasion but has neither a
// package nor a live posting. Same honest framing as the policy-only tier -- never "available", always
// "confirm with the business" -- and never outranks confirmed inventory (occasionOfferingScore's ceiling
// sits under the confirmed floor). Only searched when the ask carries a real occasion.
async function resolveOccasionOfferingBusinesses(location, occasion, searchMiles = undefined) {
  if (!location || !occasion) return [];
  const rows = await searchOccasionOfferingBusinesses({
    occasion,
    latitude: location.latitude,
    longitude: location.longitude,
    ...(searchMiles ? { radiusMiles: searchMiles } : {}),
  });
  return rows.map((row) => ({
    type: 'business_policy_match',
    viaOccasionOffering: true,
    id: row.partner_id,
    partnerId: row.partner_id,
    distanceMiles: row.distance_miles ?? null,
    title: resultTitleText('offersOccasion', { business: row.partner_name, occasion: occasionLabel(occasion) }),
    subtitle: resultNoteText('askWhatTheyCan'),
    // found BECAUSE the business declared it offers this occasion (search_occasion_offering_businesses)
    reasons: [occasionOfferedReason(occasionLabel(occasion))].filter(Boolean),
    // occasionOfferingScore = the offering itself + the close-by bonus, named apart
    ...scored([
      { code: 'base_occasion_offering', delta: occasionOfferingScore(null) },
      { code: 'base_close_distance', delta: occasionOfferingScore(row.distance_miles) - occasionOfferingScore(null) },
    ]),
  }));
}

// Item 68 ("Businesses could create occasion-specific offers," CLAUDE.md):
// a business's own durable, named occasion package -- e.g. a restaurant's
// "Birthday Package" (dessert + a group table, minimum 6 guests, available
// Fri/Sat, $X/person), a bowling alley's "Birthday Group Package," a spa's
// "Birthday Group Experience," a golf course's "Birthday Golf Package."
// Only ever searched when the ask carries a real occasion -- there is no
// meaningful "occasion package" without one, and search_occasion_packages
// itself requires it. Distinct from resolveBusinessAvailability above: a
// package is a standing product, not a one-time posted time-boxed slot, so
// it's surfaced as its own real candidate type (business_occasion_package)
// rather than folded into that tier -- CelebrateSomethingScreen's own
// dedupeBusinessCandidates() (celebrateSomething.js) renders both
// generically, side by side.
async function resolveOccasionPackages(location, occasion, partySize, searchMiles = undefined) {
  if (!location || !occasion) return [];
  const rows = await searchOccasionPackages({
    occasionType: occasion,
    latitude: location.latitude,
    longitude: location.longitude,
    partySize: partySize ?? null,
    // never narrower than the packages search's own default
    ...(searchMiles ? { radiusMiles: Math.max(searchMiles, 25) } : {}),
  });
  return rows.map((row) => {
    const { score, baseSignals } = scored([
      { code: 'base_package', delta: SCORE_OCCASION_PACKAGE_FLOOR },
      { code: 'base_close_distance', delta: row.distance_miles != null && row.distance_miles < 2 ? SCORE_CLOSE_DISTANCE : 0 },
    ]);
    const detail = formatOccasionPackageDetail({
      pricePerPerson: row.price_per_person, minGuests: row.min_guests, availableDays: row.available_days,
    });
    return {
      type: 'business_occasion_package',
      id: row.id,
      partnerId: row.partner_id,
      distanceMiles: row.distance_miles ?? null,
      title: `🎁 ${row.partner_name} — ${row.name}`,
      subtitle: detail,
      category: row.category ?? null,
      includedItems: row.included_items ?? [],
      score,
      baseSignals,
    };
  });
}

// Resolves a submitted intent against every real, already-existing
// fulfillment path Nearby has -- gatherings, communities the caller
// already belongs to, friends/matches independently asking for the same
// thing, standing perks, and a business's own already-posted live
// availability -- and ranks them on one shared, real-signal score instead
// of a fixed hierarchy. Only when every one of these genuinely returns
// nothing does the caller ever see the "ask nearby businesses fresh, then
// wait for a real offer" fallback (HomeScreen's own intentEmptyFallback
// branch) -- that path stays a distinct, secondary option because it's a
// materially different kind of result (asynchronous, not yet answered),
// not because business supply is inherently lower priority than social
// supply. No fabricated results, no stranger discovery — every branch
// here reads already-real, already-existing data, and nothing here
// creates or commits to anything. `partySize` is optional (create-assistant's
// own best-effort classification, already collected upstream, never a new
// fetch) -- only used to bound the weaker policy-only tier's own eligibility
// check against a real business's stated party-size range. `occasion` is
// the same shape (create-assistant's own best-effort WHY-signal, already
// extracted since the "Intelligent demand inbox" pass but never actually
// threaded through here until the Intent engine vision's first increment,
// 2026-09-06) -- only ever a ranking bonus against a business's own real,
// declared priority_occasions (resolveBusinessAvailability), never a
// filter and never written anywhere.
export async function resolveIntent({ category, dateWindow, rawText, partySize = null, priceLevel = null, budgetMax = null, partyType = null, attributes = [], cuisine = null, occasion = null, whoForFriendId = null, whoForName = null, energies = [], openNowChip = false, openEnded = false, narrowGroup = null }) {
  // "my girlfriend" = a date party when the extractor named none (constants/askFacets.js, deterministic).
  partyType = partyType ?? partnerPartyType(rawText);
  // Item 63: an ask naming two or more parts of an outing ("dinner and something to do after") is ONE plan. A single
  // category would hard-filter every part but one out, so it is dropped here and the cross-category recipe assembles the
  // plan instead; the occasion is filled from the person's own words only when the extractor gave none (utils/planAsk.js).
  const multiPart = planAsk(rawText);
  if (multiPart) category = null;
  // Same occasion rule as the no-AI fallback, so behavior is identical with or without the AI: explicit words, or a couple
  // planning a multi-part evening. Never from a category alone.
  occasion = occasion ?? occasionFromAsk(rawText, { partyType, dateWindow });
  // Item 85: a date is a WHO/WHY, not a market. When the only category is a date word itself (Date Night, First Date, Couples:
  // the Dating & Social group), it no longer filters: the declared qualities, price, time and party decide, so a coffee shop
  // its owner marked date-friendly can be the answer. A real market the person named ("coffee date", "dinner") still filters.
  const dateAsk = isDateAsk({ partyType, occasion });
  let dateTag = null;
  if (dateAsk && category && canonicalGroupForTag(category) === 'dating_social') { dateTag = category; category = null; }
  // Item 103: a category named only after a hedge ("preferably with live music") is nice-to-have: it no longer filters, it lifts.
  let preferredTag = null;
  if (category && isPreferredCategory(rawText, category)) { preferredTag = category; category = null; }
  // A date is two people unless the words say otherwise (never overrides a stated size).
  // Item 86: restrictions read only a size the person stated, never this date default.
  const statedPartySize = partySize;
  partySize = datePartySize(rawText, { partyType, occasion, partySize });
  // Items 51/52: pet-friendly / date-friendly / quiet / patio are ATTRIBUTES the ask can name (constants/askFacets.js), unioned with the extractor's.
  attributes = [...new Set([...(Array.isArray(attributes) ? attributes : []), ...attributesFromAsk(rawText, { partyType })])];
  // Item 80: private events and catering are asked for only in the person's own words (never inferred from a large party or an
  // occasion), and their lift is owned by the capability pass below, so they are kept out of the generic attribute overlap.
  attributes = wordsBackedAttributes(attributes, rawText).filter((a) => a !== 'private_dining' && a !== 'catering');
  // Resolved once, up front, before any branch runs in parallel below —
  // not a check-only call. getNearbyGatherings() (called from
  // resolveGatherings) already calls the shared location provider
  // itself, which prompts if the decision hasn't been made yet; a
  // previous version of this function used the non-prompting
  // getForegroundPermissionsAsync() here, running at the same instant as
  // that prompt once every branch below moved to Promise.allSettled — a
  // real race on a genuine first-time permission decision, where this
  // check could read "not yet granted" a moment before the user answered
  // the dialog gatherings' own call had just triggered, silently
  // skipping perks/business availability for that submission. Requesting
  // here instead and awaiting it before the parallel branches start
  // removes the race entirely; Location's request call is idempotent, so
  // resolveGatherings' own internal call just re-reads the
  // now-already-decided status, no second dialog.
  let location = null;
  let myCity = null;
  try {
    const position = await getUserLocation();
    if (position) {
      location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      // Best-effort only -- feeds the Community Area city-name fallback
      // below when a candidate community has no coarse map point set.
      // Never used to infer anything from free text; this is the
      // caller's own real device location, reverse-geocoded, same
      // "review before commit" honesty as every other location signal
      // in this resolver.
      try {
        const [place] = await Location.reverseGeocodeAsync(location);
        myCity = place?.city ?? null;
      } catch (geoErr) {
        myCity = null;
      }
    }
  } catch (e) {
    console.error('resolveIntent location error', e);
  }

  // Kicked off here, right alongside the parallel resolver branches below
  // -- never awaited on its own before they start, so a real weather
  // fetch (getSocialForecast's own ~2s round trip) never adds sequential
  // latency to an ask-box submission. resolveGatherings awaits this
  // itself, only once it's already done its own network work, by which
  // point the weather fetch has had the same real head start as every
  // other branch. A failed/absent fetch degrades to no weather signal,
  // never a broken submission.
  const weatherPromise = location
    ? getSocialForecast(location.latitude, location.longitude).catch(() => null)
    : Promise.resolve(null);

  // "Anniversaries could work the same way" follow-up (CLAUDE.md): real
  // "favorite businesses" (business_followers) / "past plans" (a genuine
  // past accepted-or-completed business_request_offers row) personalization
  // signals. Kicked off here, never awaited before the branches below
  // start, same "no added sequential latency" discipline weatherPromise
  // above already established -- resolveBusinessAvailability awaits this
  // itself, only once it's already done its own network work. Best-effort,
  // fails open to empty sets rather than blocking or breaking the resolver.
  const affinitySignalsPromise = getMyBusinessAffinitySignals().catch(() => ({
    followedPartnerIds: new Set(), pastPartnerIds: new Set(), declaredInterests: [],
  }));

  // Item 100 (CLAUDE.md): only fetched when the ask actually carries a real
  // who-for person -- best-effort, degrades to an empty signal on any
  // failure. Never awaited before the branches below start, same
  // no-added-latency discipline the two promises above already establish.
  const whoForSignalsPromise = whoForFriendId
    ? getWhoForPreferenceSignals(whoForFriendId).catch(() => ({ cuisineKeys: [], venueKeys: [] }))
    : Promise.resolve({ cuisineKeys: [], venueKeys: [] });

  // Item 137: how far this person usually goes per category (their own past choices). Started now, awaited by its pass.
  const learnedProximityPromise = getMyLearnedProximity().catch(() => ({}));

  // Item 69: "willing to travel" widens every search one step on the shared radius list (15 -> 30 mi), bounded by its maximum.
  const distanceWillingness = distanceWillingnessFromText(rawText);
  const travelMiles = travelSearchMiles(distanceWillingness);

  const branches = await Promise.allSettled([
    resolveGatherings(category, dateWindow, rawText, priceLevel, partyType, weatherPromise, !!travelMiles),
    resolveCommunities(category, location, myCity),
    resolveConnectedRequests(category, dateWindow),
    resolvePerks(category, location),
    resolveBusinessAvailability(category, location, attributes, cuisine, partySize, partyType, occasion, affinitySignalsPromise, whoForSignalsPromise, whoForName, activitiesFromText(rawText), travelMiles),
    resolvePolicyOnlyBusinesses(location, partySize, travelMiles),
    resolveOccasionPackages(location, occasion, partySize, travelMiles),
    resolveOccasionOfferingBusinesses(location, occasion, travelMiles),
  ]);

  const candidates = [];
  for (const branch of branches) {
    if (branch.status === 'fulfilled') {
      candidates.push(...branch.value);
    } else {
      console.error('resolveIntent branch error', branch.reason);
    }
  }

  // A business with both a confirmed live posting and a standing policy
  // must only ever appear once, at its stronger (confirmed) tier -- never
  // twice at two confidence levels. Deterministic, per direct instruction:
  // confirmed live always outranks policy-only, so the policy-only
  // duplicate is the one dropped, not decided by score.
  // The same rule now spans all four business tiers (live posting > package > offers-this-occasion >
  // policy-only): a weaker tier is dropped when the same business has a stronger one.
  let deduped = dedupeBusinessTiers(candidates);
  const removedAsDuplicates = candidates.length - deduped.length;

  // One best-effort partner lookup (hours, pulse, booking mode) shared by eligibility (open now) and ranking (commitment,
  // capabilities, dietary, vibe); a failure is an empty map (every business unknown, no booking mode), never a broken search.
  let partnerInfo = new Map();
  const businessIds = deduped.filter((c) => c.partnerId && (BUSINESS_RESULT_TYPES.includes(c.type) || c.type === 'perk')).map((c) => c.partnerId);
  if (businessIds.length > 0) {
    try {
      partnerInfo = await getPartnerOperatingInfo(businessIds);
    } catch (e) {
      console.error('partner operating lookup skipped', e);
    }
  }
  // Item 72: every BUSINESS result carries its partner row, so its tap follows the same booking-mode action as its profile
  // (utils/businessAction.js), and its declared mode feeds commitment (walk-in = drop in, book/request first = reservation).
  // Perks get neither: a perk keeps its own validity rules and is never turned into Book/Request.
  deduped = deduped.map((c) => {
    if (!BUSINESS_RESULT_TYPES.includes(c.type) || !c.partnerId || !partnerInfo.has(c.partnerId)) return c;
    const partner = partnerInfo.get(c.partnerId);
    const mode = bookingModeOf(partner);
    return { ...c, businessPartner: partner, ...(mode ? { bookingMode: mode } : {}) };
  });

  // ---- Stage 1: ELIGIBILITY (item 118, utils/askEligibility.js). Every existing hard constraint of the ask, in one ordered
  // pass, BEFORE any ranking: what fails a rule is removed here and recorded by rule, so nothing that will not be shown can move
  // another result (the stated-distance and travel-mode passes compare results with each other). Unknown stays eligible.
  // The person's words, or Discover's Open-now chip they switched on (openNowChip): one filter either way.
  const openNowOnly = !!openNowChip || openNowAskFromText(rawText);
  const restrictionFacts = restrictionAsk(rawText, statedPartySize);
  const openEndedGroups = openEndedAskGroups({ category, rawText, occasion, attributes, force: !!openEnded });
  const narrowedGroup = isCategoryGroup(narrowGroup) ? narrowGroup : null;
  const parsedFacets = parseAskFacets(rawText);
  const isPartnerResult = (c) => c.partnerId && (BUSINESS_RESULT_TYPES.includes(c.type) || c.type === 'perk');
  // Outdoor / indoor from DECLARED data only (constants/environmentMatch.js, one rule for every surface): a gathering by its
  // host's outdoor seating or its category, a business or perk by its own weather setting / outdoor seating (never its
  // category; a failed partner lookup = unknown), anything else by its category.
  const envOf = (c) => {
    if (c?.type === 'gathering') return gatheringEnvironment({ interest_tag: c.category, features: c.features });
    // The partner row, else the business's own declarations the result already carries (a posting's copy of its attributes).
    if (isPartnerResult(c)) return businessEnvironment(partnerInfo.get(c.partnerId) ?? null) ?? (c.type === 'perk' ? null : businessEnvironment({ attributes: c.matchedAvailability?.attributes ?? c.attributes }));
    return categoryEnvironment(c?.category);
  };
  const eligibility = await runAskEligibility(deduped, {
    restrictionFacts, declinedLookup: getDeclinedBusinesses, isPartnerResult, isBusiness: (c) => BUSINESS_RESULT_TYPES.includes(c.type),
    openEndedGroups, narrowGroup: narrowedGroup, facets: parsedFacets, openNowOnly, toEntity: (c) => candidateEntity(c, partnerInfo), envOf,
  });
  deduped = eligibility.items;

  // ---- Stage 2: RANKING, only on the eligible candidates.
  // Typed-ask audit (utils/typedAskAudit.js): READ-ONLY. Each trace.step names what the pass just before it changed; it never
  // writes to a candidate, never reorders, and swallows its own errors. Its exclusions = Stage 1's removals by rule (+ dedupe).
  const trace = guardTrace(() => createScoreTrace(deduped, { removedBeforeStart: removedAsDuplicates, removed: eligibility.removed }));
  // The ranking ledger (constants/signalPriority.js, the one ranking framework): the same per-pass diff as the audit trace, kept
  // apart from it so the audit can never change an order. It also sees the two passes the audit never records. Each result's
  // order comes from its tier vector: a stronger tier always beats any amount of a weaker one. A ledger failure = order by score.
  let ledger = null;
  try { ledger = createRankLedger(deduped); } catch (e) { ledger = null; }
  const step = (code) => { ledger?.step(code, deduped); trace.step(code, deduped); };
  const unrecorded = (code) => { ledger?.step(code, deduped); trace.rebase(deduped); };

  // Weather nudges, never dictates (2026-09-26, utils/askWeather.js): a gathering is judged at its own start, everything else at
  // the window the person's words anchor ("tonight", "tomorrow", "Saturday before 3 PM"); no anchor or "this weekend" = no
  // weather effect, and today's conditions are never used for another day. Indoor/outdoor from existing metadata only (a
  // business's declared weather_setting, item 63, else its category). Ranking only; an explicit "outdoor"/"indoor" ask is never
  // reinterpreted. Best-effort: no weather = unchanged order.
  let weatherCaption = null;
  try {
    const weather = await weatherPromise;
    const settings = weather ? await getPartnerWeatherSettings(deduped.map((c) => c.partnerId).filter(Boolean)) : null;
    const applied = applyAskWeather(deduped, weather, { text: rawText, explicitEnvironment: parseAskFacets(rawText).environment ?? null, settingByPartnerId: settings });
    deduped = applied.items;
    weatherCaption = applied.caption;
  } catch (e) {
    console.error('weather nudge skipped', e);
  }
  step('weather');

  // Items 40 + 82: a business whose declared tier fits the asked price, or whose typical spend fits a stated budget, ranks up;
  // a typical spend clearly over the budget, or a $$$/$$$$ tier on "not too expensive", ranks down. Never a filter.
  const askPricey = parseAskFacets(rawText).pricey;
  if (priceLevel || budgetMax || askPricey) {
    try {
      deduped = applyBusinessPriceToCandidates(deduped, await getPartnerPriceInfo(deduped.map((c) => c.partnerId)), { priceLevel, budgetMax, pricey: askPricey }, SCORE_HAPPENING_NOW);
    } catch (e) {
      console.error('business price nudge skipped', e);
    }
  }
  step('price_budget');

  // Energy level (item 44): "something low-key" lifts tags that carry that energy; ranking only (constants/energyLevel.js).
  // Item 65: an energy the person PICKED ("What kind of night?") joins the ones their words name.
  // Item 66: a format the person named ("a pickleball tournament") lifts that format and sinks a known different one; never hides.
  deduped = applyFormatToCandidates(deduped, formatsFromText(rawText));
  step('format');
  // Item 67: "beginner pickleball" lifts a declared Beginner / All levels / Casual game and sinks a Competitive one; never hides.
  deduped = applySkillToCandidates(deduped, skillLevelsFromText(rawText));
  step('skill_level');
  // "rock show tonight" lifts gatherings whose host declared Rock; a different/undeclared genre is neutral, nothing hidden.
  deduped = applyGenreToCandidates(deduped, genresFromText(rawText));
  step('genre');
  // Intensity (the host's Energy scale) and effort, only from "easy hike" / "high intensity workout"-style phrases; never hides.
  const askedIntensity = intensityFromText(rawText);
  deduped = applyIntensityToCandidates(deduped, askedIntensity);
  step('intensity');
  deduped = applyEffortToCandidates(deduped, effortFromText(rawText));
  step('effort');
  // Social context (2026-09-26): "a few friends" / "big group hike" / "meet new people" compared against the gathering's existing
  // party_type, capacity and group_size_feel; gatherings only, ranking only, nothing stored.
  deduped = applySocialToCandidates(deduped, socialSignalsFromText(rawText), { partyType });
  step('social_context');
  // Item 69: "walking distance" / "not too far" lift the closer results by their real measured distance (relative, no mile cutoffs);
  // "willing to travel" already widened the search above. Nothing is removed.
  deduped = applyDistanceWillingness(deduped, distanceWillingness);
  step('distance_willingness');
  // Transportation mode (2026-09-26): "I'm walking" / "on my bike" lift closer results relative to the others; "I'm driving" /
  // "an Uber" drop the close-by bonus; transit changes nothing without real travel times. A stated distance stays primary and the
  // mode only refines (small weight, same direction). Never widens the search. getTravelTimes has NO provider today (returns
  // null, no network); it is the plug-in point for the future server-side routing layer, which ranking reads only as seconds.
  const transportMode = transportModeFromText(rawText);
  const travelTimes = transportMode ? await getTravelTimes(deduped, transportMode, location, { keyOf: candidateKey }) : null;
  deduped = applyTransportMode(deduped, transportMode, travelTimes, { statedDistance: distanceWillingness });
  step('transport_mode');
  // Item 137, adaptive personal proximity: within the person's usual trip for THIS result's category +1, well beyond it -1
  // (utils/learnedProximity.js). Learned from their own joins / accepted offers only; off whenever the words state a distance
  // or a way of travelling (those stay in control); never widens the search or removes anything; nothing learned = no change.
  const learnedProximity = learnedProximityApplies({ distanceWillingness, transportMode }) ? await learnedProximityPromise : null;
  deduped = applyLearnedProximity(deduped, learnedProximity);
  step('learned_proximity');
  // Item 68: "I only have an hour" lifts what fits (declared length, else the category's typical one) and sinks what clearly
  // does not; unknown lengths are untouched, nothing is removed.
  const timeBudget = timeBudgetFromText(rawText);
  deduped = applyTimeBudgetToCandidates(deduped, timeBudget);
  step('time_budget');
  // "today before 3 PM" / "Saturday until 5": used only when the person's words anchor it to a date ("before 3 PM" alone
  // constrains nothing). A gathering whose real start (and usual length) fits lifts, a clear miss sinks; never hides.
  const clockWindow = clockWindowFromText(rawText);
  const dateAnchor = clockWindow ? dateAnchorFromText(rawText) : null;
  deduped = applyClockWindowToCandidates(deduped, clockWindow, dateAnchor);
  step('clock_window');
  const askedEnergies = energiesWithoutIntensity([...new Set([...(Array.isArray(energies) ? energies : []), ...energiesFromText(rawText)])], askedIntensity);
  deduped = applyEnergyToCandidates(deduped, energiesWithoutIntensity([...new Set([...(Array.isArray(energies) ? energies : []), ...energiesFromText(rawText)])], askedIntensity));
  step('energy');

  // Commitment (item 45) and spontaneity (item 46): ranking only. An immediate ask implies a light commitment unless the person
  // said otherwise; "plan ahead" / "next few hours" have no dateWindow bucket, so they come from the person's own words.
  const spontaneity = spontaneityOf({ dateWindow, rawText });
  const commitAsk = commitmentAsk(rawText) ?? (isImmediate(spontaneity) ? 'light' : null);
  // Item 86 compatibility (what the words state vs what a business declared) was decided in Stage 1.
  // Item 88: dietary needs the person's own words state ("vegan", "gluten-free", "halal") lift a business that DECLARED every one
  // of them (its partner row, attached above). Ranking only; a business that did not say is kept where it was.
  deduped = applyDietaryToCandidates(deduped, dietaryFromAsk(rawText));
  unrecorded('dietary'); // a stated dietary need moves the order but is never recorded (UNRECORDED_PASSES)
  // Item 80: declared capabilities vs the ask: largest group vs the stated party size, private events / catering only when the
  // words ask for them. Ranking only; unknown is neutral; business results only (perks carry no partner row).
  deduped = applyCapabilitiesToCandidates(deduped, { partySize, text: rawText });
  step('capabilities');
  // Item 130: "probably a group" (a birthday / family occasion with no stated number) lifts businesses that declared they take
  // groups, +1. Never a headcount: `partySize` stays as said, and nothing here reaches a business.
  deduped = applyLikelyGroupToCandidates(deduped, likelyGroupFromAsk({ text: rawText, occasion, partyType, partySize: statedPartySize }));
  step('likely_group');
  deduped = applyCommitmentToCandidates(deduped, commitAsk);
  step('commitment');
  deduped = applySpontaneityToCandidates(deduped, spontaneity);
  step('spontaneity');

  // Open-ended ask ("something fun tonight"): Stage 1 kept only inventory in the ask's groups; here those results get the small
  // lift (utils/openEndedAsk.js, rule-based). A real category or occasion in the ask leaves everything untouched.
  deduped = openEndedLift(deduped, openEndedGroups, { dateWindow, partyType, hour: new Date().getHours() });
  step('open_ended');
  // Item 108's Browse-category narrowing was applied in Stage 1.

  // Age range (item 50): "with my 5 year old" ranks a place or gathering whose declared suited ages cover it; an unknown range is untouched.
  const childAges = askedChildAges(rawText);
  if (childAges.length > 0) {
    try {
      const ranges = await getPartnerSuitedAges(deduped.map((c) => c.partnerId));
      deduped = applySuitedAgesToCandidates(deduped.map((c) => (c.partnerId && ranges.has(c.partnerId) ? { ...c, ...ranges.get(c.partnerId) } : c)), childAges);
    } catch (e) {
      console.error('suited age nudge skipped', e);
    }
  }
  unrecorded('suited_ages'); // a stated child's age moves the order but is never recorded (UNRECORDED_PASSES)

  // Accessibility / family (items 49/50): a gathering the HOST declared these features for ranks up (declared only, never inferred).
  deduped = applyDeclaredFeatures(deduped, attributes);
  step('declared_features');
  // Vibe (item 83): a declared vibe the person said to avoid, or the declared opposite of one they want, sinks a little. Never hides.
  deduped = applyVibeSinks(deduped, vibesFromAsk(rawText));
  step('vibe');
  // Item 114: what the person asked for tonight outranks who they usually are (constants/sessionIntent.js).
  deduped = applySessionIntent(deduped, sessionIntentFromText(rawText));
  step('session_intent');
  // Item 85: more of the asked qualities declared = higher; a date ask offers a declared date spot as "Date night at X?"; a
  // gathering carrying the date tag the words named keeps a lift now that the tag no longer filters.
  deduped = applyQualityDepth(deduped, attributes);
  step('quality_depth');
  deduped = frameDatePlaces(deduped, { isDate: dateAsk, frame: dateFrame({ occasion, dateWindow }), businessTypes: BUSINESS_RESULT_TYPES });
  step('date_place');
  if (dateTag) deduped = deduped.map((c) => (c.category === dateTag ? { ...c, score: (c.score ?? 0) + SCORE_HAPPENING_NOW } : c));
  step('date_tag');
  if (preferredTag) deduped = deduped.map((c) => (c.category === preferredTag ? { ...c, score: (c.score ?? 0) + PREFERRED_CATEGORY_POINTS } : c));
  step('preferred_category');

  // Combinations + negative intent (items 47/48): "outside", "no alcohol", "nothing crowded", "not too expensive" from the person's
  // own words. Exclusions drop only KNOWN conflicts; the caption says what was left out (constants/askFacets.js).
  // Stage 1 removed the known conflicts; the stated environment's lift and the "not too expensive" sink apply here.
  deduped = askFacetsLift(deduped, parsedFacets, envOf);
  step('ask_facets');

  // Open now (owner item 71, utils/operatingStatus.js, the one resolver): "what's open" / "still open" / "somewhere I can go
  // right now" keeps ONLY confirmed-usable results (unknown and closed both drop out). An immediate ask without that language
  // only lifts businesses and perks that are confirmed usable (available +2, open +1); gatherings already rank by their real
  // start in the spontaneity pass, so they get no second lift. Nothing about this is stored or sent to a business.
  // The open-now filter itself ran in Stage 1; an immediate ask without that language gets only this lift.
  if (!openNowOnly && isImmediate(spontaneity)) {
    const toEntity = (c) => candidateEntity(c, partnerInfo);
    deduped = deduped.map((c) => (c.type === 'gathering' ? c : { ...c, score: (c.score ?? 0) + openNowLift(toEntity(c)) }));
  }
  step('open_now');

  if (ledger) deduped = deduped.map((c) => ({ ...c, rankVector: typedAskRankVector(ledger.signalsFor(c)) }));
  deduped.sort(compareRanked);
  // The caption names only the groups the SHOWN results really come from.
  // (One caption line on both screens: the open-ended groups, then the spontaneity line when the ask named one.)
  const openEndedNote = [openNowOnly ? OPEN_NOW_CAPTION : null, planCaption(rawText, { occasion, dateWindow }), openEndedCaption(deduped.slice(0, RESULT_CAP), openEndedGroups), spontaneityCaption(spontaneity), timeBudgetCaption(timeBudget), clockWindowCaption(clockWindow, dateAnchor), distanceWillingnessCaption(distanceWillingness), transportModeCaption(transportMode, { statedDistance: distanceWillingness }), weatherCaption, askFacetsCaption(parsedFacets, eligibility.removedOpposite, eligibility.removedUnknown), eligibility.compatibilityCaption].filter(Boolean).join(' · ') || null;

  // Intent engine vision -- cross-category "Experiences" assembly, first
  // increment (2026-09-10): a pure regrouping of this same already-scored,
  // already-deduped candidate pool, computed BEFORE the RESULT_CAP slice
  // below so a genuinely strong match further down the ranked list still
  // gets a real chance to fill a component -- never limited to just the
  // flat list's own top few. Returns null whenever the ask carries no real
  // occasion, the occasion has no defined template, or no component found
  // genuine matching inventory; callers only ever render an Experience
  // section when this is truthy.
  // A multi-part plan is measured against the time the person said they have (or an anchored range such as "tonight between
  // 6 and 8 PM"): combinations that fit lead, every part stays, and the plan says its approximate total (utils/planTiming.js).
  const planBudget = timeBudget ?? windowSpan(clockWindow, dateAnchor);
  const planSpanLabel = timeBudget == null && planBudget != null ? `${clockLabel(clockWindow.after)} and ${clockLabel(clockWindow.before)}` : null;
  const experience = fitExperienceToTime(assembleExperience(occasion, deduped, { partyType, dateWindow, attributes, priceLevel, budgetMax, category, cuisine, intentRecipe: recognizeCombination({ text: rawText, occasion, partyType, dateWindow, attributes })?.recipe ?? null }), planBudget, planSpanLabel);

  // What the ranking path actually used, closed vocabularies only (never words; sanitized again by the writer).
  let audit = null;
  try {
    const social = socialSignalsFromText(rawText);
    audit = {
      candidateCount: deduped.length,
      trace,
      interpretation: {
        category, category_group: category ? canonicalGroupForTag(category) : null, preferred_category: preferredTag, date_tag: dateTag,
        cuisine, occasion, combination: recognizeCombination({ text: rawText, occasion, partyType, dateWindow, attributes })?.key ?? null,
        multi_part: !!multiPart, date_window: dateWindow, party_size: partySize, party_size_stated: Number.isInteger(statedPartySize),
        party_type: partyType, price_level: priceLevel, budget_max: budgetMax, attributes, energies: askedEnergies,
        formats: formatsFromText(rawText), skill_levels: skillLevelsFromText(rawText), genres: genresFromText(rawText),
        intensity: askedIntensity, effort: effortFromText(rawText), social_context: social?.social_context ?? null,
        meet_new_people: social?.meet_new_people ?? null, distance_willingness: distanceWillingness, search_widened: !!travelMiles,
        transport_mode: transportMode, time_budget_minutes: timeBudget, clock_window: clockWindow,
        date_anchor: dateAnchor?.kind ?? null, commitment: commitAsk, spontaneity, open_now: openNowOnly, open_now_chip: !!openNowChip,
        environment: parsedFacets.environment, environment_required: !!parsedFacets.environmentRequired, exclude: parsedFacets.exclude,
        avoid_pricey: !!parsedFacets.pricey, open_ended_groups: openEndedGroups, narrow_group: narrowedGroup, vibes_avoid: [...(vibesFromAsk(rawText).avoid ?? [])],
      },
    };
  } catch (e) {
    console.error('typed-ask audit skipped', e);
  }
  return { items: deduped.slice(0, RESULT_CAP), experience, openEndedNote, openNowOnly, audit };
}

// A synthetic result item (not a real resolveIntent() candidate) --
// appended only when detectFriendDiscoveryIntent(typedText) is true.
// Moved here (Item 39, CLAUDE.md) from HomeScreen.js, which had it as a
// private, unexported helper -- now shared so Discover's own search box
// can append the identical "meet people" fallback that Home's ask box
// already does, instead of silently doing without it. Copy matches
// FriendDiscoveryScreen's own header subtitle verbatim, not re-worded, so
// the same promise ("separate from dating") is stated identically
// wherever it appears. HomeScreen.js now imports this instead of keeping
// its own copy.
export function buildFriendDiscoveryResultItem(category) {
  return {
    type: 'friend_discovery',
    id: 'friend-discovery',
    title: category ? `Meet people who like ${category}` : 'Meet new people nearby',
    subtitle: resultNoteText('friendDiscovery'),
  };
}

// Item 39 (CLAUDE.md, "search should understand the same language as the
// intent box"): the one real gap the audit found was Discover's own
// unified search box, which only ever did a literal ILIKE substring match
// over titles/descriptions/tags (searchGatherings/searchPublicCommunities/
// searchOffers) -- a real, non-literal ask like "something fun with my
// girlfriend Saturday" has no title/tag it could ever literally match, so
// it always fell straight through to "nothing matched anywhere" -> Create
// It, never actually understood. This function is that understanding
// layer, callable from any search surface, not just Home's own ask box --
// composes the exact same classifyCreateRequest()/resolveIntent()/
// resolveCommunityIntent()/detectFriendDiscoveryIntent() calls, with the
// same branching semantics, HomeScreen's own handleHomeIntentSubmit
// already uses inline. Deliberately NOT a refactor of HomeScreen's own
// implementation into a call to this function -- that inline code is
// mature, already correctly handles several Home-specific concerns
// interleaved with it (Surprise Me clearing, RSVP nudges), and has no
// automated test coverage in a codebase with no simulator/device testing
// available -- extracting it now would be a real regression risk for no
// behavioral gain, since both call sites end up composing the identical
// underlying functions either way. A future session can fold
// handleHomeIntentSubmit into this same function once that refactor can
// actually be verified; until then, "the same language" is guaranteed by
// both going through the same classify/resolve calls with the same
// params, not by one single call site.
//
// Returns one of three shapes, discriminated by `outcome`:
// - 'business_partner': no existing-supply concept to check (matches
//   handleHomeIntentSubmit's own business_partner branch) -- the caller
//   should route straight to RequestBusinessPartner.
// - 'results': items.length > 0 -- items/experience ready to render, same
//   shape resolveIntent()/resolveCommunityIntent() already return.
// - 'empty': genuinely checked and found nothing -- the caller's own
//   "ask nearby businesses fresh" / "create it yourself" fallback applies.
// `onPhase` (Item 135, optional): called as the real pipeline actually moves between phases
// ('understanding' before the classify call, 'finding' once it returns), so a caller can narrate
// real work. Fire-and-forget: it never delays or affects the search.
export async function runIntentSearch(typedText, { onPhase } = {}) {
  // Surprise Me / "I don't know what I want" are their own intent (services/surpriseMe.js): never classified, searched or logged
  // here, whichever surface calls this. Callers route them to the Surprise Me engine first; this is the backstop.
  const pick = pickForMeKind(typedText);
  if (pick) return { outcome: 'pick_for_me', pick, typedText, items: [], experience: null };
  recordSearchBehavior(typedText); // item 95: a private ranking signal (category only), never a profile edit
  onPhase?.({ phase: 'understanding' });
  const classifyResult = await classifyCreateRequest(typedText);
  onPhase?.({ phase: 'finding', classifyResult });

  if (classifyResult.intent === 'business_partner') {
    const submissionId = await recordIntentSubmission({
      rawText: typedText, category: classifyResult.category ?? null, dateWindow: classifyResult.dateWindow ?? null,
      intentKind: 'business_partner', hadAnyResult: false, reachedBusinessFallback: false,
    });
    return { outcome: 'business_partner', classifyResult, typedText, submissionId, items: [], experience: null };
  }

  if (classifyResult.intent === 'community') {
    const resolved = await resolveCommunityIntent({ category: classifyResult.category, rawText: typedText });
    const submissionId = await recordIntentSubmission({
      rawText: typedText, category: classifyResult.category ?? null, dateWindow: classifyResult.dateWindow ?? null,
      intentKind: 'community', hadAnyResult: resolved.length > 0, reachedBusinessFallback: false,
    });
    return {
      outcome: resolved.length > 0 ? 'results' : 'empty',
      classifyResult, typedText, submissionId, items: resolved, experience: null,
    };
  }

  const { items, experience, openEndedNote, openNowOnly, audit } = await resolveClassifiedAsk(classifyResult, typedText);
  const submissionId = await recordIntentSubmission({
    rawText: typedText, category: classifyResult.category ?? null, dateWindow: classifyResult.dateWindow ?? null,
    intentKind: classifyResult.intent, hadAnyResult: items.length > 0, reachedBusinessFallback: items.length === 0,
    partySize: classifyResult.partySize ?? null,
  });
  return {
    outcome: items.length > 0 ? 'results' : 'empty',
    classifyResult, typedText, submissionId, items, experience, openEndedNote, openNowOnly, audit,
  };
}

// The ONE resolve for an already-classified typed ask: Discover's search (above), Home's ask box and every refinement chip on
// both (services/askRefine.js). Same words + classification in = same results out, whichever surface asks. The friend-discovery
// row is appended as before (a person-shaped phrase, never a fabricated candidate), except on an Open-now ask, which keeps only
// confirmed-open things.
export async function resolveClassifiedAsk(classifyResult, typedText) {
  const { items: resolved, experience, openEndedNote, openNowOnly, audit } = await resolveIntent({
    category: classifyResult.category, dateWindow: classifyResult.dateWindow, rawText: typedText,
    partySize: classifyResult.partySize ?? null, priceLevel: classifyResult.priceLevel ?? null, budgetMax: classifyResult.budgetMax ?? null,
    partyType: classifyResult.partyType ?? null, attributes: classifyResult.attributes ?? [],
    cuisine: classifyResult.cuisine ?? null, occasion: classifyResult.occasion ?? null, narrowGroup: classifyResult.narrowGroup ?? null,
  });
  // The meet-people row is not in any category, so it is not added while a category narrows the ask (item 108).
  const items = detectFriendDiscoveryIntent(typedText) && !openNowOnly && !classifyResult.narrowGroup
    ? [...resolved, buildFriendDiscoveryResultItem(classifyResult.category)]
    : resolved;
  return { items, experience, openEndedNote, openNowOnly: openNowOnly === true, audit };
}

// Item 74 (CLAUDE.md): INTENT_SEARCH_TYPE_EMOJI/intentSearchDateLabel/
// intentSearchFallbackTitle (extracted from DiscoverHubScreen.js, which
// used to define these as its own private helpers) now live in
// intentResolverScoring.js, not here -- this file transitively imports
// supabase/expo-location and can't be imported in a plain Jest/Node test
// at all (confirmed: importing it throws trying to strip types out of an
// expo-modules-core file under node_modules), so a pure helper that
// deserves its own test has to live in that dependency-free sibling module
// instead, same reasoning its own header comment already gives for every
// other export in it. Both DiscoverHubScreen.js and
// CelebrateSomethingScreen.js import them from there directly.

// Pure routing: given a resolveIntent()/runIntentSearch() result item,
// navigates to its real matching destination. Extracted (Item 39,
// CLAUDE.md) from HomeScreen.js's own handleIntentResultTap, which had
// this identical switch inlined -- Discover's own search box needed the
// exact same routing (a gathering result should always land on
// GatheringDetail regardless of which search box found it), and hand-
// rolling a second copy is exactly the kind of drift item 39 itself warns
// about. `typedText`/`classifyResult` are only used by the two business_*
// branches, to prefill AskBusinessScreen the same way every other entry
// point into it already does -- both are safely omittable for a context
// that doesn't have them (e.g. Surprise Me's own restricted result set,
// which never reaches these two types in the first place).
export function navigateToIntentResultItem(navigation, item, { typedText, classifyResult, submissionId } = {}) {
  // Item 135: the tap follows the context object's ONE destination (utils/recommendationContext.js). Item 72: a business result
  // follows its booking-mode route (maps for Go now / Directions, the request addressed to it for Reserve / Book / Request).
  if ((item.type === 'perk' || BUSINESS_RESULT_TYPES.includes(item.type)) && item.partnerId) logBusinessProfileView(item.partnerId, 'intent_match');
  openDestination(navigation, intentResultDestination(item, { typedText, classifyResult, submissionId }));
}

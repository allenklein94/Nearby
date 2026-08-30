import * as Location from 'expo-location';
import { getNearbyGatherings, getGatheringFitReasons } from './gatherings';
import { getMyCommunities, getPublicCommunities } from './communities';
import { getActiveOffers } from './brandOffers';
import { getConnectedOpenBusinessRequests, searchActiveBusinessAvailability, searchPolicyOnlyBusinesses } from './businessFulfillment';
import { getSocialForecast } from './homeDashboard';
import { isIndoorCategory, isOutdoorCategory } from '../constants/gatheringIndoorOutdoor';
import { isWeatherIndoorBiased, isWeatherOutdoorBiased } from '../utils/weatherBias';
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
  priceAndPartyBonus,
  attributeAndCuisineBonus,
  accommodatesPartyTypeBonus,
} from './intentResolverScoring';

const RESULT_CAP = 4;

// P2 item 7 (Universal Signal Remediation Pass, CLAUDE.md, Aug 28 2026):
// weatherPromise is a real, already-in-flight promise (kicked off by
// resolveIntent right after location resolves, in parallel with this
// function's own getNearbyGatherings() call and every other resolver
// branch) -- never awaited before this function starts its own work, so
// wiring weather into the ask box doesn't add sequential latency to
// every submission. Closes the audit's own confirmed gap ("reaches
// neither the ask box... at all") using the one shared
// isWeatherIndoorBiased/isWeatherOutdoorBiased definition
// (utils/weatherBias.js) -- the identical real signal and weight
// (SCORE_HAPPENING_NOW) homeRecommendations.js's own weatherAdjustment()
// already uses, not a second invented rule.
async function resolveGatherings(category, dateWindow, rawText, priceLevel, partyType, weatherPromise = null) {
  const nearby = await getNearbyGatherings('wide');
  const relevant = nearby.filter((g) => {
    if (category && g.interest_tag !== category) return false;
    return matchesDateWindow(g.scheduled_at, dateWindow);
  });
  const meaningfulWords = extractMeaningfulWords(rawText);
  const weather = weatherPromise ? await weatherPromise : null;
  return relevant.map((gathering) => {
    const { reasons } = getGatheringFitReasons(gathering);
    // Universal Signal Remediation Pass, P0 item 1 (CLAUDE.md, Aug 28 2026):
    // capacity/approvedAttendees are already fetched by getNearbyGatherings()
    // -- this was a pure mapping omission, not a missing query. A full
    // gathering is never hidden (it can still be the single best match, and
    // a waitlist spot can open), but the caller can now render an honest
    // "Full -- Join Waitlist" state on the result card itself instead of
    // only discovering it one screen later on GatheringDetailScreen.
    const attendeeCount = gathering.approvedAttendees?.length ?? 0;
    const isFull = gathering.capacity != null && attendeeCount >= gathering.capacity;
    let weatherBonus = 0;
    if (weather) {
      if (isWeatherIndoorBiased(weather) && isIndoorCategory(gathering.interest_tag)) {
        weatherBonus = SCORE_HAPPENING_NOW;
        reasons.push(REASON_TEXT.WEATHER_GOOD_INDOOR.text);
      } else if (isWeatherOutdoorBiased(weather) && isOutdoorCategory(gathering.interest_tag)) {
        weatherBonus = SCORE_HAPPENING_NOW;
        reasons.push(REASON_TEXT.WEATHER_GOOD_OUTDOOR.text);
      }
    }
    return {
      type: 'gathering',
      id: gathering.id,
      title: gathering.title,
      // Matches GatheringDetailScreen's own established "🔒 Full —
      // N/M spots taken" copy, not a new visual language invented here.
      subtitle: isFull ? `🔒 Full — Join Waitlist (${attendeeCount}/${gathering.capacity} spots taken)` : (reasons[0] ?? null),
      capacity: gathering.capacity ?? null,
      attendeeCount,
      isFull,
      score: scoreGatheringForResolver(gathering)
        + titleMentionBonus(gathering.title, meaningfulWords)
        + priceAndPartyBonus(gathering, priceLevel, partyType)
        + weatherBonus,
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
    .filter((c) => c.interest_tag === category)
    .map((c) => ({
      type: 'community',
      id: c.id,
      title: c.name,
      subtitle: "You're already a member",
      score: SCORE_OWN_NETWORK + communityAreaBonus(c, location, myCity),
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
    .filter((c) => c.interest_tag === category)
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

  return [...joined, ...discoverable].sort((a, b) => b.score - a.score).slice(0, RESULT_CAP);
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
    title: `${r.requester_display_name ?? 'A friend'} is also looking for this`,
    subtitle: r.raw_text,
    // Product-critique follow-through, Aug 14 2026 (recommendation 3):
    // a plain accepted friendship has no messages/matches row behind it
    // at all -- only a real dating match does -- so Message is only ever
    // offered when the RPC's own match_id genuinely resolves to one, not
    // assumed just because this is a "connected" result.
    matchId: r.match_id ?? null,
    score: SCORE_OWN_NETWORK,
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
    title: offer.title,
    subtitle: offer.brand_partners?.name ?? null,
    // A perk with no target_interest_tag is visible to everyone (no real
    // match signal); one that's actually targeted at this category is a
    // real, comparable match, same weight as a gathering's own interest
    // match.
    score: offer.target_interest_tag && offer.target_interest_tag === category ? SCORE_INTEREST_MATCH : 0,
  }));
}

// Real, live business supply -- a business already declared these terms
// in advance (Phase 4's "proactive availability"), so unlike the Tier 4
// fallback below, this is genuinely queryable right now, not something
// that requires submitting a fresh ask and waiting. This is what makes
// the business path a real candidate instead of a dead end -- see the
// integration audit for the gap this closes.
async function resolveBusinessAvailability(category, location, attributes, cuisine, partySize, partyType) {
  if (!location) return [];
  // Universal Signal Remediation Pass, P0 item 2 (CLAUDE.md, Aug 28 2026):
  // a real hard feasibility filter now, not just relevance -- a posting
  // whose real remaining capacity can't fit the requester's own real
  // party size is excluded server-side entirely, never merely ranked
  // lower. partySize is already resolved once at the top of
  // resolveIntent() and passed to every branch that needs it, same as
  // category/location.
  const rows = await searchActiveBusinessAvailability({
    category: category ?? null,
    latitude: location.latitude,
    longitude: location.longitude,
    partySize: partySize ?? null,
  });
  return rows.map((row) => {
    let score = 0;
    // Only count as a real category match when the posting itself is
    // targeted -- an untargeted posting matching by virtue of category
    // being null isn't a genuine signal, same reasoning as perks above.
    if (category && row.category && row.category === category) score += SCORE_INTEREST_MATCH;
    if (row.distance_miles != null && row.distance_miles < 2) score += SCORE_CLOSE_DISTANCE;
    // P0 item 3 (CLAUDE.md, Aug 28 2026): a structural confidence floor,
    // not a relevance bonus -- eligibility already guarantees ends_at >
    // now(), so any result here is, by construction, both available right
    // now AND confirmed (unlike business_policy_match's own "may be able
    // to help"). Previously plain SCORE_HAPPENING_NOW, whose real minimum
    // (2) could lose to policy-only's real maximum (SCORE_CLOSE_DISTANCE,
    // 3) -- a documented cross-tier ranking violation. This floor
    // structurally exceeds that maximum, closing it for good.
    score += SCORE_CONFIRMED_AVAILABILITY_FLOOR;
    // Taxonomy Post-Implementation Audit remediation (CLAUDE.md, Aug 28
    // 2026), item 3: a real cuisine/attribute overlap between what the ask
    // implies and this posting's own business is a meaningful ranking
    // bonus, not a hard filter -- a relevant business can now outrank a
    // less relevant but slightly closer one, without ever hiding an
    // otherwise-eligible posting outright.
    score += attributeAndCuisineBonus(row, attributes, cuisine);
    // "10/10 blueprint" audit, Finding 8 (CLAUDE.md, Aug 30 2026): the
    // business's own real accommodates_party_types now propagates all the
    // way to a consumer-facing ranking bonus, not just its public profile.
    score += accommodatesPartyTypeBonus(row, partyType);
    return {
      type: 'business_availability',
      id: row.id,
      partnerId: row.partner_id,
      title: `${row.partner_name} has availability`,
      subtitle: row.price != null ? `${row.title} · $${row.price}` : row.title,
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
async function resolvePolicyOnlyBusinesses(location, partySize) {
  if (!location) return [];
  const rows = await searchPolicyOnlyBusinesses({
    latitude: location.latitude,
    longitude: location.longitude,
    partySize: partySize ?? null,
  });
  return rows.map((row) => ({
    type: 'business_policy_match',
    id: row.partner_id,
    partnerId: row.partner_id,
    title: `${row.partner_name} may be able to help`,
    // Exact wording per direct instruction: never "Available" -- this is a
    // standing willingness, not confirmed inventory.
    subtitle: 'May be available — business confirmation required',
    score: row.distance_miles != null && row.distance_miles < 2 ? SCORE_CLOSE_DISTANCE : 0,
  }));
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
// check against a real business's stated party-size range.
export async function resolveIntent({ category, dateWindow, rawText, partySize = null, priceLevel = null, partyType = null, attributes = [], cuisine = null }) {
  // Resolved once, up front, before any branch runs in parallel below —
  // not a check-only call. getNearbyGatherings() (called from
  // resolveGatherings) already calls Location.requestForegroundPermissionsAsync()
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
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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

  const branches = await Promise.allSettled([
    resolveGatherings(category, dateWindow, rawText, priceLevel, partyType, weatherPromise),
    resolveCommunities(category, location, myCity),
    resolveConnectedRequests(category, dateWindow),
    resolvePerks(category, location),
    resolveBusinessAvailability(category, location, attributes, cuisine, partySize, partyType),
    resolvePolicyOnlyBusinesses(location, partySize),
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
  const confirmedPartnerIds = new Set(
    candidates.filter((c) => c.type === 'business_availability' && c.partnerId).map((c) => c.partnerId)
  );
  const deduped = candidates.filter(
    (c) => !(c.type === 'business_policy_match' && confirmedPartnerIds.has(c.partnerId))
  );

  deduped.sort((a, b) => b.score - a.score);
  return deduped.slice(0, RESULT_CAP);
}

import * as Location from 'expo-location';
import { getNearbyGatherings, getGatheringFitReasons } from './gatherings';
import { getMyCommunities, getPublicCommunities } from './communities';
import { getActiveOffers } from './brandOffers';
import { getConnectedOpenBusinessRequests, searchActiveBusinessAvailability } from './businessFulfillment';
// 10/10 roadmap Part 8: these five pure helpers used to be defined
// locally in this file -- moved verbatim (no behavior change) to
// intentResolverScoring.js so they're directly unit-testable without
// dragging in this file's own I/O-touching imports above. See that
// file's own header comment for the full reasoning.
import {
  SCORE_INTEREST_MATCH,
  SCORE_CLOSE_DISTANCE,
  SCORE_HAPPENING_NOW,
  SCORE_OWN_NETWORK,
  extractMeaningfulWords,
  titleMentionBonus,
  matchesDateWindow,
  dateWindowToDateRange,
  scoreGatheringForResolver,
} from './intentResolverScoring';

const RESULT_CAP = 4;

async function resolveGatherings(category, dateWindow, rawText) {
  const nearby = await getNearbyGatherings('wide');
  const relevant = nearby.filter((g) => {
    if (category && g.interest_tag !== category) return false;
    return matchesDateWindow(g.scheduled_at, dateWindow);
  });
  const meaningfulWords = extractMeaningfulWords(rawText);
  return relevant.map((gathering) => {
    const { reasons } = getGatheringFitReasons(gathering);
    return {
      type: 'gathering',
      id: gathering.id,
      title: gathering.title,
      subtitle: reasons[0] ?? null,
      score: scoreGatheringForResolver(gathering) + titleMentionBonus(gathering.title, meaningfulWords),
    };
  });
}

// Communities have no scheduled date/urgency signal the way a gathering
// does, so with no detected category there's no real signal that any
// particular community the caller belongs to is relevant to this specific
// ask -- unlike gatherings (which still have date/distance/attendance to
// rank by), an uncategorized "all your communities" result would be noise,
// not a real match. Gated on a real category instead of surfaced broadly.
async function resolveCommunities(category) {
  if (!category) return [];
  const mine = await getMyCommunities();
  return mine
    .filter((c) => c.interest_tag === category)
    .map((c) => ({
      type: 'community',
      id: c.id,
      title: c.name,
      subtitle: "You're already a member",
      score: SCORE_OWN_NETWORK,
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
async function resolveBusinessAvailability(category, location) {
  if (!location) return [];
  const rows = await searchActiveBusinessAvailability({
    category: category ?? null,
    latitude: location.latitude,
    longitude: location.longitude,
  });
  return rows.map((row) => {
    let score = 0;
    // Only count as a real category match when the posting itself is
    // targeted -- an untargeted posting matching by virtue of category
    // being null isn't a genuine signal, same reasoning as perks above.
    if (category && row.category && row.category === category) score += SCORE_INTEREST_MATCH;
    if (row.distance_miles != null && row.distance_miles < 2) score += SCORE_CLOSE_DISTANCE;
    // Eligibility already guarantees ends_at > now(), so any result here
    // is, by construction, available right now -- a real "happening now"
    // signal, not a guess.
    score += SCORE_HAPPENING_NOW;
    return {
      type: 'business_availability',
      id: row.id,
      partnerId: row.partner_id,
      title: `${row.partner_name} has availability`,
      subtitle: row.price != null ? `${row.title} · $${row.price}` : row.title,
      matchedAvailability: {
        partnerName: row.partner_name,
        title: row.title,
        description: row.description,
        offerType: row.offer_type,
        price: row.price,
      },
      score,
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
// creates or commits to anything.
export async function resolveIntent({ category, dateWindow, rawText }) {
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
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    }
  } catch (e) {
    console.error('resolveIntent location error', e);
  }

  const branches = await Promise.allSettled([
    resolveGatherings(category, dateWindow, rawText),
    resolveCommunities(category),
    resolveConnectedRequests(category, dateWindow),
    resolvePerks(category, location),
    resolveBusinessAvailability(category, location),
  ]);

  const candidates = [];
  for (const branch of branches) {
    if (branch.status === 'fulfilled') {
      candidates.push(...branch.value);
    } else {
      console.error('resolveIntent branch error', branch.reason);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, RESULT_CAP);
}

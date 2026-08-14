import * as Location from 'expo-location';
import { getNearbyGatherings, getGatheringFitReasons } from './gatherings';
import { getMyCommunities } from './communities';
import { getActiveOffers } from './brandOffers';
import { getConnectedOpenBusinessRequests, searchActiveBusinessAvailability } from './businessFulfillment';

const RESULT_CAP = 4;

// Shared relevance weights, kept on the same scale
// getGatheringFitReasons() already established (interest match = 5, close
// distance = 3, happening today/now = 2) so every candidate type competes
// on one real, comparable axis instead of a fixed tier-fill order. See
// PRODUCT_AUDIT/INTENT_LAYER_INTEGRATION_AUDIT_2026-08-14.md for why this
// replaced the old sequential "gatherings fill 4 slots, then maybe
// friend-asks, then maybe perks" design -- that design let a handful of
// loosely-matching gatherings silently starve out a perfectly-matching
// perk or a business's own live availability, since nothing was ever
// scored against anything else.
const SCORE_INTEREST_MATCH = 5;
const SCORE_CLOSE_DISTANCE = 3;
const SCORE_HAPPENING_NOW = 2;
// A real signal from the caller's own social graph (already a member /
// a friend independently asking for the same thing) is weighted a little
// above a plain interest-tag match, matching this app's standing
// no-stranger-discovery principle: your own network is worth more than an
// anonymous category match, but this is still a flat weight for a real,
// present signal -- not a fabricated score.
const SCORE_OWN_NETWORK = 6;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Same coarse date-window vocabulary GatheringsScreen.js's own date-filter
// chips already use (today/tomorrow/weekend) — kept as a small,
// self-contained equivalent here rather than importing from a screen file,
// so this new service has no dependency on any screen. "tonight"/"now"
// both fold into "today" for matching purposes — no time-of-day precision
// beyond that. This is intentional: it matches this codebase's standing
// "AI never infers a specific date/time" rule (see CLAUDE.md's Create 2.0
// section) — dateWindow is a coarse bucket for filtering *existing*
// results, never a specific date or clock time used to create/publish
// anything.
function matchesDateWindow(scheduledAt, dateWindow) {
  if (!dateWindow || dateWindow === 'flexible') return true;
  const date = new Date(scheduledAt);
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  if (dateWindow === 'today' || dateWindow === 'tonight' || dateWindow === 'now') {
    return date >= todayStart && date < tomorrowStart;
  }
  if (dateWindow === 'tomorrow') {
    const dayAfterStart = new Date(tomorrowStart);
    dayAfterStart.setDate(dayAfterStart.getDate() + 1);
    return date >= tomorrowStart && date < dayAfterStart;
  }
  if (dateWindow === 'weekend') {
    const dayOfWeek = todayStart.getDay();
    const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
    const saturdayStart = new Date(todayStart);
    saturdayStart.setDate(saturdayStart.getDate() + daysUntilSaturday);
    const mondayStart = new Date(saturdayStart);
    mondayStart.setDate(mondayStart.getDate() + 2);
    return date >= saturdayStart && date < mondayStart;
  }
  return true;
}

// Translates the same coarse dateWindow vocabulary above into a concrete
// date for comparing against business_requests.date (a plain date column,
// unlike gatherings' scheduled_at timestamp) — same today/tomorrow/weekend
// boundaries as matchesDateWindow, just returning a date instead of a
// range check. Returns null for 'flexible'/unset, meaning "don't filter by
// date" — matches the RPC's own (date_param is null or ...) passthrough.
function dateWindowToDateParam(dateWindow) {
  if (!dateWindow || dateWindow === 'flexible') return null;
  const now = new Date();
  const todayStart = startOfDay(now);
  if (dateWindow === 'today' || dateWindow === 'tonight' || dateWindow === 'now') {
    return todayStart.toISOString().slice(0, 10);
  }
  if (dateWindow === 'tomorrow') {
    const d = new Date(todayStart);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (dateWindow === 'weekend') {
    const dayOfWeek = todayStart.getDay();
    const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
    const d = new Date(todayStart);
    d.setDate(d.getDate() + daysUntilSaturday);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

// getGatheringFitReasons() (services/gatherings.js) is the shared scorer
// Home's Best Pick and GatheringDetailScreen's "Why this fits you" already
// use -- but its real score also adds up to +10 for attendee count and +1
// for beginner-friendly, neither of which belongs on the *cross-type*
// scale this resolver actually documents (interest match/close distance/
// happening today, same SCORE_* constants every other branch below uses).
// Left uncalled for scoring here on purpose -- a popular gathering would
// otherwise systematically outrank a perfectly-fitting perk or business
// availability posting, the exact bias PRODUCT_AUDIT/
// INTENT_LAYER_UX_WALKTHROUGH_2026-08-14.md found. getGatheringFitReasons()
// is still called below for its `reasons` text (a real, richer subtitle)
// -- only the *score* it returns is unused, so Home's Best Pick and
// GatheringDetailScreen (both real, already-shipped, unmodified) are
// unaffected by this.
function scoreGatheringForResolver(gathering) {
  let score = 0;
  if (gathering.matchesYourInterests) score += SCORE_INTEREST_MATCH;
  if (gathering.distanceMiles !== null && gathering.distanceMiles !== undefined && gathering.distanceMiles < 2) {
    score += SCORE_CLOSE_DISTANCE;
  }
  const scheduled = new Date(gathering.scheduled_at);
  const now = new Date();
  const isToday = scheduled.getFullYear() === now.getFullYear() && scheduled.getMonth() === now.getMonth() && scheduled.getDate() === now.getDate();
  if (isToday) score += SCORE_HAPPENING_NOW;
  return score;
}

async function resolveGatherings(category, dateWindow) {
  const nearby = await getNearbyGatherings('wide');
  const relevant = nearby.filter((g) => {
    if (category && g.interest_tag !== category) return false;
    return matchesDateWindow(g.scheduled_at, dateWindow);
  });
  return relevant.map((gathering) => {
    const { reasons } = getGatheringFitReasons(gathering);
    return {
      type: 'gathering',
      id: gathering.id,
      title: gathering.title,
      subtitle: reasons[0] ?? null,
      score: scoreGatheringForResolver(gathering),
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

async function resolveConnectedRequests(category, dateWindow) {
  const connected = await getConnectedOpenBusinessRequests({
    category: category ?? null,
    date: dateWindowToDateParam(dateWindow),
  });
  return connected.map((r) => ({
    type: 'friend_request',
    id: r.id,
    userId: r.requester_id,
    title: `${r.requester_display_name ?? 'A friend'} is also looking for this`,
    subtitle: r.raw_text,
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
export async function resolveIntent({ category, dateWindow }) {
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
    resolveGatherings(category, dateWindow),
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

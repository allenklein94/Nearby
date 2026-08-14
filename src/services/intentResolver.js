import * as Location from 'expo-location';
import { getNearbyGatherings, getGatheringFitReasons } from './gatherings';
import { getActiveOffers } from './brandOffers';
import { getConnectedOpenBusinessRequests } from './businessFulfillment';

const RESOLVER_RESULT_CAP = 4;

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

// Tiers 1-3 of the Intent Layer's resolver (CLAUDE.md's "Intent Layer +
// Business Fulfillment" plan). Tier 2 (friends/matches who've
// independently expressed compatible intent) was sequenced right after
// Phase 2 landed, per the plan's own note — it sources its signal from
// Phase 2's business_requests table via a narrow SECURITY DEFINER RPC, not
// a broadened SELECT policy. Tier 4 (asking a business for a real offer)
// is Phase 2's AskBusinessScreen, reached from Home when this resolver
// returns nothing. This function only ever reads already-real,
// already-existing supply/social-graph signal — no fabricated results,
// and nothing here creates or commits to anything.
export async function resolveIntent({ category, dateWindow }) {
  const results = [];

  try {
    const nearby = await getNearbyGatherings('wide');
    const relevant = nearby.filter((g) => {
      if (category && g.interest_tag !== category) return false;
      return matchesDateWindow(g.scheduled_at, dateWindow);
    });
    const scored = relevant
      .map((g) => ({ gathering: g, ...getGatheringFitReasons(g) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, RESOLVER_RESULT_CAP);
    for (const { gathering, reasons } of scored) {
      results.push({
        type: 'gathering',
        id: gathering.id,
        title: gathering.title,
        subtitle: reasons[0] ?? null,
      });
    }
  } catch (e) {
    console.error('resolveIntent gatherings error', e);
  }

  if (results.length < RESOLVER_RESULT_CAP) {
    try {
      const connected = await getConnectedOpenBusinessRequests({
        category: category ?? null,
        date: dateWindowToDateParam(dateWindow),
      });
      for (const r of connected.slice(0, RESOLVER_RESULT_CAP - results.length)) {
        results.push({
          type: 'friend_request',
          id: r.id,
          userId: r.requester_id,
          title: `${r.requester_display_name ?? 'A friend'} is also looking for this`,
          subtitle: r.raw_text,
        });
      }
    } catch (e) {
      console.error('resolveIntent connected requests error', e);
    }
  }

  if (results.length < RESOLVER_RESULT_CAP) {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const offers = await getActiveOffers(location.coords.latitude, location.coords.longitude);
        const relevant = category ? offers.filter((o) => !o.target_interest_tag || o.target_interest_tag === category) : offers;
        for (const offer of relevant.slice(0, RESOLVER_RESULT_CAP - results.length)) {
          results.push({
            type: 'perk',
            id: offer.id,
            title: offer.title,
            subtitle: offer.brand_partners?.name ?? null,
          });
        }
      }
    } catch (e) {
      console.error('resolveIntent offers error', e);
    }
  }

  return results;
}

import * as Location from 'expo-location';
import { getNearbyGatherings, getGatheringFitReasons } from './gatherings';
import { getActiveOffers } from './brandOffers';

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

// Tier 1 + Tier 3 of the Intent Layer's resolver (CLAUDE.md's "Intent Layer
// + Business Fulfillment" plan) — Phase 1b. Tier 2 (friends/matches who've
// independently expressed compatible intent) is deliberately not built
// here — it needs Phase 2's business_requests table to source its signal
// from, so it's sequenced right after Phase 2 lands, not before. Tier 4
// (asking a business for a real offer) is Phase 2 itself. This function
// only ever reads already-real, already-existing supply (gatherings and
// standing perks) — no new schema, no fabricated results, and nothing here
// creates or commits to anything.
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

import { occasionLabel } from '../constants/businessAttributes';
import { tr } from '../i18n/translate';
import { bizIsEnglish, bizLanguage } from '../i18n/bizFormat';
import { categoryName } from '../i18n/categoryNames';

const D = (key, vars) => tr(`ui.bizHelp.demand.${key}`, vars);
// A category / occasion name in the viewer's language (the stored value is unchanged).
const cat = (value) => (bizIsEnglish() ? value : categoryName(value, bizLanguage()));

// Turns one row from get_partner_demand_signals() into the card's copy + the ONE existing
// business action it maps to. Every number shown is a real value from that RPC; nothing is
// estimated. The server already enforces the privacy floor (min_people); this re-checks it so a
// bad row can never render as "2 people".
const PARTY_KEYS = { '1-2': 'p12', '3-4': 'p34', '5-6': 'p56', '7+': 'p7' };

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PERIODS = ['morning', 'afternoon', 'evening'];
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// "Friday evening" only when the server returned a floored, complement-checked cell with a real day AND period.
export function whenLabel(day, period) {
  return DAYS.includes(day) && PERIODS.includes(period) ? D(`when.${period}`, { day: bizIsEnglish() ? cap(day) : D(`day.${day}`) }) : null;
}

export function partyBucketLabel(bucket) {
  return PARTY_KEYS[bucket] ? D(`party.${PARTY_KEYS[bucket]}`) : null;
}

// "N of them this weekend": only when the server returned a floored, complement-checked count (requests only), and never
// more than the row's own people. Re-checked here so a bad row can't render a small or impossible number.
export function weekendLine(signal, minPeople = 5) {
  const w = Number(signal?.weekend_count);
  const total = Number(signal?.people_count);
  if (signal?.weekend_count == null || !Number.isInteger(w) || w < minPeople || (Number.isFinite(total) && w > total)) return null;
  return D('weekend', { count: w });
}

// The owner's own open matched opportunities (first-party, never floored) as one line at the top of the card.
export function describeMatchSummary(count) {
  if (!Number.isInteger(count) || count <= 0) return null;
  return {
    line: D('matchSummary', { count }),
    actionLabel: D('viewOpportunities'),
    action: { type: 'opportunities' },
  };
}

export function describeDemandSignal(signal, { minPeople = 5, windowDays = 14, openByCategory = {} } = {}) {
  const people = Number(signal?.people_count);
  if (!signal || !Number.isFinite(people) || people < minPeople) return null;
  const peopleSince = D('peopleSince', { count: people, days: windowDays });

  if (signal.kind === 'occasion' && signal.occasion) {
    const noun = cat(occasionLabel(signal.occasion));
    return {
      key: `occasion:${signal.occasion}`,
      headline: D('occasionHeadline', { occasion: noun }),
      detail: [peopleSince, weekendLine(signal, minPeople)].filter(Boolean).join(' · '),
      actionLabel: D('createPackage', { occasion: noun }),
      action: { type: 'package', occasion: signal.occasion },
    };
  }

  if (signal.kind === 'group' && Number(signal.min_party) >= 2) {
    return {
      key: 'group',
      headline: D('groupHeadline', { n: signal.min_party }),
      detail: [peopleSince, weekendLine(signal, minPeople)].filter(Boolean).join(' · '),
      actionLabel: D('postAvailability'),
      action: { type: 'availability', category: null },
    };
  }

  // Interested-in-gatherings: its own row and floor, never combined with request counts. Category + count only.
  if (signal.kind === 'gathering_interest' && signal.category) {
    return {
      key: `gathering_interest:${signal.category}`,
      headline: D('interestHeadline', { count: people, category: cat(signal.category) }),
      detail: D('anonymousSince', { days: windowDays }),
      actionLabel: D('postAvailability'),
      action: { type: 'availability', category: signal.category },
    };
  }

  if (signal.kind === 'category' && signal.category) {
    const party = partyBucketLabel(signal.party_bucket);
    const low = Number(signal.budget_low);
    const high = Number(signal.budget_high);
    const hasBudget = signal.budget_low != null && signal.budget_high != null && Number.isFinite(low) && Number.isFinite(high);
    const budget = hasBudget ? (low === high ? D('budgetAround', { amount: low }) : D('budgetRange', { low, high })) : null;
    // Unfulfilled demand: only when the server returned it (it applies its own >= 5 floor), re-checked here.
    const waiting = Number(signal.unfulfilled_count);
    const hasWaiting = signal.unfulfilled_count != null && Number.isFinite(waiting) && waiting >= minPeople;
    const supply = Number(signal.supply_count);
    const hasSupply = hasWaiting && signal.supply_count != null && Number.isFinite(supply) && supply >= 0;
    const unmet = hasWaiting
      ? [D('waiting', { count: waiting }), hasSupply ? D('supply', { count: supply }) : null].filter(Boolean).join(' · ')
      : null;
    return {
      key: `category:${signal.category}`,
      headline: party ? D('categoryHeadlineParty', { category: cat(signal.category), party }) : D('categoryHeadline', { category: cat(signal.category) }),
      // Separate, independently floored facts -- never phrased as one group of people who wanted all of them.
      detail: [whenLabel(signal.when_day, signal.when_period), signal.outdoor === true ? D('outdoorSeating') : null, budget, peopleSince, weekendLine(signal, minPeople), unmet].filter(Boolean).join(' · '),
      actionLabel: D('postAvailability'),
      action: { type: 'availability', category: signal.category },
      ...(Number.isInteger(openByCategory[signal.category]) && openByCategory[signal.category] > 0
        ? {
            matchLine: D('openInCategory', { count: openByCategory[signal.category] }),
            secondaryActionLabel: D('viewOpportunities'),
            secondaryAction: { type: 'opportunities' },
          }
        : {}),
    };
  }
  return null;
}

export function describeDemandSignals(payload, { openByCategory = {} } = {}) {
  const opts = { minPeople: payload?.min_people ?? 5, windowDays: payload?.window_days ?? 14, openByCategory };
  return (payload?.signals ?? []).map((s) => describeDemandSignal(s, opts)).filter(Boolean);
}

import { occasionLabel } from '../constants/businessAttributes';

// Turns one row from get_partner_demand_signals() into the card's copy + the ONE existing
// business action it maps to. Every number shown is a real value from that RPC; nothing is
// estimated. The server already enforces the privacy floor (min_people); this re-checks it so a
// bad row can never render as "2 people".
const PARTY_LABELS = { '1-2': '1–2 people', '3-4': '3–4 people', '5-6': '5–6 people', '7+': '7 or more people' };

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PERIODS = ['morning', 'afternoon', 'evening'];
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// "Friday evening" only when the server returned a floored, complement-checked cell with a real day AND period.
export function whenLabel(day, period) {
  return DAYS.includes(day) && PERIODS.includes(period) ? `${cap(day)} ${period}` : null;
}

export function partyBucketLabel(bucket) {
  return PARTY_LABELS[bucket] ?? null;
}

export function describeDemandSignal(signal, { minPeople = 5, windowDays = 14, openByCategory = {} } = {}) {
  const people = Number(signal?.people_count);
  if (!signal || !Number.isFinite(people) || people < minPeople) return null;
  const since = `last ${windowDays} days`;

  if (signal.kind === 'occasion' && signal.occasion) {
    const noun = occasionLabel(signal.occasion);
    return {
      key: `occasion:${signal.occasion}`,
      headline: `${noun} plans are being requested nearby`,
      detail: `${people} people · ${since}`,
      actionLabel: `Create a ${noun} package`,
      action: { type: 'package', occasion: signal.occasion },
    };
  }

  if (signal.kind === 'group' && Number(signal.min_party) >= 2) {
    return {
      key: 'group',
      headline: `Groups of ${signal.min_party}+ are looking nearby`,
      detail: `${people} people · ${since}`,
      actionLabel: 'Post availability',
      action: { type: 'availability', category: null },
    };
  }

  if (signal.kind === 'category' && signal.category) {
    const party = partyBucketLabel(signal.party_bucket);
    const low = Number(signal.budget_low);
    const high = Number(signal.budget_high);
    const hasBudget = signal.budget_low != null && signal.budget_high != null && Number.isFinite(low) && Number.isFinite(high);
    const budget = hasBudget ? (low === high ? `Budget around $${low}/person` : `Budget $${low}–$${high}/person`) : null;
    // Unfulfilled demand: only when the server returned it (it applies its own >= 5 floor), re-checked here.
    const waiting = Number(signal.unfulfilled_count);
    const hasWaiting = signal.unfulfilled_count != null && Number.isFinite(waiting) && waiting >= minPeople;
    const supply = Number(signal.supply_count);
    const hasSupply = hasWaiting && signal.supply_count != null && Number.isFinite(supply) && supply >= 0;
    const unmet = hasWaiting
      ? `${waiting} still waiting for an offer${hasSupply ? ` · ${supply} ${supply === 1 ? 'business offers' : 'businesses offer'} this nearby` : ''}`
      : null;
    return {
      key: `category:${signal.category}`,
      headline: `${signal.category}${party ? ` for ${party}` : ''} is being searched nearby`,
      // Separate, independently floored facts -- never phrased as one group of people who wanted all of them.
      detail: [whenLabel(signal.when_day, signal.when_period), signal.outdoor === true ? 'Outdoor seating' : null, budget, `${people} people · ${since}`, unmet].filter(Boolean).join(' · '),
      actionLabel: 'Post availability',
      action: { type: 'availability', category: signal.category },
      ...(Number.isInteger(openByCategory[signal.category]) && openByCategory[signal.category] > 0
        ? {
            matchLine: `You have ${openByCategory[signal.category]} open ${openByCategory[signal.category] === 1 ? 'opportunity' : 'opportunities'} in this category`,
            secondaryActionLabel: 'View opportunities',
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

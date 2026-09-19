import { occasionLabel } from '../constants/businessAttributes';

// Turns one row from get_partner_demand_signals() into the card's copy + the ONE existing
// business action it maps to. Every number shown is a real value from that RPC; nothing is
// estimated. The server already enforces the privacy floor (min_people); this re-checks it so a
// bad row can never render as "2 people".
const PARTY_LABELS = { '1-2': '1–2 people', '3-4': '3–4 people', '5-6': '5–6 people', '7+': '7 or more people' };

export function partyBucketLabel(bucket) {
  return PARTY_LABELS[bucket] ?? null;
}

export function describeDemandSignal(signal, { minPeople = 5, windowDays = 14 } = {}) {
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

  if (signal.kind === 'category' && signal.category) {
    const party = partyBucketLabel(signal.party_bucket);
    const low = Number(signal.budget_low);
    const high = Number(signal.budget_high);
    const hasBudget = signal.budget_low != null && signal.budget_high != null && Number.isFinite(low) && Number.isFinite(high);
    const budget = hasBudget ? (low === high ? `Budget around $${low}` : `Budget $${low}–$${high}`) : null;
    return {
      key: `category:${signal.category}`,
      headline: `${signal.category}${party ? ` for ${party}` : ''} is being searched nearby`,
      detail: [budget, `${people} people · ${since}`].filter(Boolean).join(' · '),
      actionLabel: 'Post availability',
      action: { type: 'availability', category: signal.category },
    };
  }
  return null;
}

export function describeDemandSignals(payload) {
  const opts = { minPeople: payload?.min_people ?? 5, windowDays: payload?.window_days ?? 14 };
  return (payload?.signals ?? []).map((s) => describeDemandSignal(s, opts)).filter(Boolean);
}

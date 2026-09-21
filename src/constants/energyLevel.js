// Energy level (owner item 44, 2026-09-21): "I want something low-key tonight." A person's own words name an ENERGY; a result
// carries one only through its own canonical category tag (the table below). Same shape as the activity layer: stores nothing,
// deterministic phrase rules (never AI), ranking only (a lift for a fit, a small drop for a clear opposite, never a filter), one
// honest reason line. A tag not listed has NO energy and is untouched -- nothing is guessed, and a major-only business is
// never classified. Energy is a mood of the plan, not a fact about a person: it is never stored on a profile.
export const ENERGY_LEVELS = [
  { key: 'low_key', label: 'low-key', display: 'Low-key', icon: '🛋️',
    ask: /\blow[- ]?key\b|\blaid[- ]back\b|\bchill(ed)?\b|\brelax(ed|ing)?\b|\bmellow\b|\bcalm\b|\bquiet\b|\bcozy\b|\bcosy\b|\bnothing (too )?(crazy|wild)\b/i,
    opposite: ['high_energy', 'active'] },
  { key: 'social', label: 'social', display: 'Social', icon: '🥂',
    ask: /\bsocial\b|\blively\s+but\s+not\b|\bmeet\s+people\b/i, opposite: [] },
  { key: 'active', label: 'active', display: 'Active', icon: '🏃',
    ask: /\bactive\b|\bget\s+moving\b|\bwork\s?out\b|\bbreak\s+a\s+sweat\b|\bsweat\b/i, opposite: ['low_key'] },
  { key: 'high_energy', label: 'high-energy', display: 'High-energy', icon: '⚡',
    ask: /\bhigh[- ]?energy\b|\blively\b|\bhype\b|\bwild\b|\bparty(ing)?\b|\bgo\s+all\s+out\b/i, opposite: ['low_key'] },
  { key: 'romantic', label: 'romantic', display: 'Romantic', icon: '🕯️',
    ask: /\bromantic\b|\bintimate\b/i, opposite: [] },
  { key: 'adventurous', label: 'adventurous', display: 'Adventurous', icon: '🧭',
    ask: /\badventur(ous|e)\b|\bthrill(ing)?\b|\btry\s+something\s+new\b/i, opposite: [] },
];

// Canonical tag -> the energies it genuinely carries. Conservative: only tags that are near-certain (Coffee is low-key, Nightclubs
// are high-energy). Ambiguous tags (Music, Sports, Travel, Dating, Foodie) are left out rather than guessed.
export const TAG_ENERGY = {
  Coffee: ['low_key'], Reading: ['low_key'], Yoga: ['low_key'], Meditation: ['low_key'], Pilates: ['low_key'],
  Museums: ['low_key'], Bakeries: ['low_key'], Walking: ['low_key'], Gardening: ['low_key'], 'Board Games': ['low_key', 'social'],
  Wine: ['low_key', 'romantic'], Wineries: ['low_key', 'romantic'], 'Fine Dining': ['romantic'],
  Trivia: ['social'], Karaoke: ['social', 'high_energy'], 'Happy Hour': ['social'], 'Bars & Lounges': ['social'], Breweries: ['social'], Brunch: ['social'],
  Fitness: ['active'], Running: ['active'], Pickleball: ['active'], Tennis: ['active'], Cycling: ['active'], Swimming: ['active'],
  Basketball: ['active'], Soccer: ['active'], Volleyball: ['active'], Skating: ['active'], 'Martial Arts': ['active'], Gyms: ['active'], Hiking: ['active', 'adventurous'],
  Nightclubs: ['high_energy'], DJs: ['high_energy'], Dancing: ['high_energy'], Concerts: ['high_energy'], Nightlife: ['high_energy'], Festivals: ['high_energy', 'social'], Arcade: ['high_energy', 'social'],
  Adventure: ['adventurous'], Climbing: ['active', 'adventurous'], 'Water Sports': ['adventurous'], Surfing: ['adventurous'], Diving: ['adventurous'], Snorkeling: ['adventurous'], Camping: ['adventurous'], 'Escape Rooms': ['adventurous', 'social'],
};

export const ENERGY_FIT_POINTS = 2;        // same as the other ask-specific bonuses (SCORE_HAPPENING_NOW)
export const ENERGY_MISMATCH_POINTS = -1;  // a clear opposite sinks a little; never hidden

// Energy keys the person's own words name (empty when none).
export function energiesFromText(text) {
  if (typeof text !== 'string' || !text) return [];
  return ENERGY_LEVELS.filter((e) => e.ask.test(text)).map((e) => e.key);
}

export function energiesForTag(tag) {
  return (tag && TAG_ENERGY[tag]) || [];
}

// A gathering's own host-declared energy (1 Chill .. 5 High energy, set in Create/Edit) beats the tag table: it is the host's word
// for THIS event. 1-2 = low-key, 4-5 = high-energy, 3 = the host said middling, so no energy is claimed either way.
export function energiesFromHost(level) {
  if (!Number.isFinite(level)) return null;
  if (level <= 2) return ['low_key'];
  if (level >= 4) return ['high_energy'];
  return [];
}

// { delta, reason } for one candidate category against the asked energies; delta 0 and reason null when nothing real applies.
export function energyFit(tag, asked, hostEnergy = null) {
  if (!Array.isArray(asked) || asked.length === 0) return { delta: 0, reason: null };
  const mine = energiesFromHost(hostEnergy) ?? energiesForTag(tag);
  if (mine.length === 0) return { delta: 0, reason: null };
  const hit = ENERGY_LEVELS.find((e) => asked.includes(e.key) && mine.includes(e.key));
  if (hit) return { delta: ENERGY_FIT_POINTS, reason: `Fits a ${hit.label} plan` };
  const clash = asked.some((k) => ENERGY_LEVELS.find((e) => e.key === k)?.opposite.some((o) => mine.includes(o)));
  return clash ? { delta: ENERGY_MISMATCH_POINTS, reason: null } : { delta: 0, reason: null };
}

// Ranking-only pass over resolver candidates (each carries its own `category` tag). Never removes one.
export function applyEnergyToCandidates(candidates, asked) {
  if (!Array.isArray(asked) || asked.length === 0) return candidates;
  return candidates.map((c) => {
    const { delta, reason } = energyFit(c?.category, asked, c?.hostEnergy);
    if (!delta) return c;
    return { ...c, score: (c.score ?? 0) + delta, subtitle: c.subtitle ?? reason ?? c.subtitle };
  });
}

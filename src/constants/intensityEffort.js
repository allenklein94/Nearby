// Intensity and effort (owner decision after item 67, 2026-09-25). Three separate questions about an activity:
//   skill     = how experienced do I need to be?        (constants/skillLevel.js, gatherings.skill_level)
//   intensity = how hard / fast / energetic is it?       (REUSES the existing host-declared gatherings.energy_level 1-5 scale)
//   effort    = how much physical / mental effort?       (gatherings.effort_level, migration 20270207)
// Intensity is not a new field: the host's "Energy" scale (Chill .. High energy, NULL = not said) already declares it; its bands
// are 1-2 Low-key, 3 Moderate, 4-5 High-energy. Both are optional, host-declared, never inferred. Asks are read by deterministic
// phrase rules ONLY when an activity word sits next to the qualifier ("easy hike", "high intensity workout"), so "easy dinner",
// "high-energy restaurant", "low-key birthday" and "hard decision" declare nothing. Ranking only: a fit lifts, a clear opposite
// sinks modestly, unknown is neutral, nothing is removed. Typed requests only (never Home/Discover feeds or business payloads).

export const INTENSITY_LEVELS = [
  { key: 'low_key', label: 'Low-key' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'high_energy', label: 'High-energy' },
];
export const EFFORT_LEVELS = [
  { key: 'light', label: 'Light' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'challenging', label: 'Challenging' },
];
export const EFFORT_KEYS = EFFORT_LEVELS.map((e) => e.key);
export const effortLabel = (key) => EFFORT_LEVELS.find((e) => e.key === key)?.label ?? null;
export const EFFORT_OPTIONS = [{ key: null, label: 'Not specified' }, ...EFFORT_LEVELS.map((e) => ({ key: e.key, label: e.label }))];

// The host's declared energy (1-5) as an intensity band; NULL/unknown = null.
export function intensityOfHostEnergy(n) {
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n <= 2 ? 'low_key' : n === 3 ? 'moderate' : 'high_energy';
}

// An activity word the qualifier must sit right next to. Deliberately physical/structured activities only (no meals, parties,
// occasions or venues).
const ACT = String.raw`(?:\w+\s+)?(?:workouts?|exercise|training|session|class(?:es)?|hikes?|hiking|walks?|walking|runs?|running|jog|rides?|ride|cycling|bike\s+ride|climbs?|climbing|swims?|swimming|paddle|kayak(?:ing)?|games?|match(?:es)?|practice|yoga|pilates|spin|bootcamp|trail|routes?|circuit)`;
const near = (q) => new RegExp(String.raw`\b(?:${q})\b[\s-]+${ACT}\b`, 'i');

const INTENSITY_ASK = [
  { key: 'high_energy', re: [/\bhiit\b/i, near(String.raw`high[\s-]?intensity|intense|fast[\s-]?paced|high[\s-]?energy`)] },
  { key: 'moderate', re: [near(String.raw`moderate(?:[\s-]intensity)?|medium[\s-]intensity`)] },
  { key: 'low_key', re: [near(String.raw`low[\s-]?key|low[\s-]?intensity|gentle|slow[\s-]?paced|chill|relaxed|relaxing`)] },
];
const EFFORT_ASK = [
  { key: 'challenging', re: [near(String.raw`challenging|hard|tough|strenuous|difficult|demanding|grueling|gruelling`)] },
  { key: 'moderate', re: [near(String.raw`moderate(?:[\s-]effort)?|medium[\s-]effort`)] },
  { key: 'light', re: [near(String.raw`easy|light|gentle|leisurely`)] },
];
const read = (table, text) => (typeof text === 'string' && text ? table.filter((t) => t.re.some((r) => r.test(text))).map((t) => t.key) : []);
export const intensityFromText = (text) => read(INTENSITY_ASK, text);
export const effortFromText = (text) => read(EFFORT_ASK, text);

export const FIT_POINTS = 2;
export const MISMATCH_POINTS = -1;
// Same level = fit; the two ends = a clear mismatch; moderate vs an end = neutral ("closer" is not penalised).
const OPPOSITE = { low_key: 'high_energy', high_energy: 'low_key', light: 'challenging', challenging: 'light' };

function fit(declared, asked, label) {
  if (!declared || !asked.length) return { delta: 0, reason: null };
  if (asked.includes(declared)) return { delta: FIT_POINTS, reason: label(declared) };
  if (asked.some((a) => OPPOSITE[a] === declared)) return { delta: MISMATCH_POINTS, reason: null };
  return { delta: 0, reason: null };
}
export const intensityFit = (c, asked) => fit(intensityOfHostEnergy(c?.hostEnergy), asked ?? [], (k) => `⚡ ${INTENSITY_LEVELS.find((i) => i.key === k).label} pace`);
export const effortFit = (c, asked) => fit(EFFORT_KEYS.includes(c?.effortLevel) ? c.effortLevel : null, asked ?? [], (k) => `💪 ${effortLabel(k)} effort`);

function apply(candidates, asked, fitFn) {
  if (!Array.isArray(asked) || !asked.length) return candidates;
  return candidates.map((c) => {
    const { delta, reason } = fitFn(c, asked);
    return delta ? { ...c, score: (c.score ?? 0) + delta, subtitle: c.subtitle ?? reason ?? c.subtitle } : c;
  });
}
export const applyIntensityToCandidates = (candidates, asked) => apply(candidates, asked, intensityFit);
export const applyEffortToCandidates = (candidates, asked) => apply(candidates, asked, effortFit);

// The general energy pass (item 44) also reads the host's energy scale. When the ask names an INTENSITY, the matching energy
// key is left to the intensity pass so the same fact is never counted twice.
export function energiesWithoutIntensity(energies, intensities) {
  const covered = new Set((intensities ?? []).filter((k) => k === 'low_key' || k === 'high_energy'));
  return (energies ?? []).filter((e) => !covered.has(e));
}

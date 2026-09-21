// Host-declared practical facts on a gathering (item 39): equipment provided, duration. Absent = the host did not say, so
// nothing renders; nothing is inferred from the category. beginner_friendly is its own existing field.
export const DURATION_OPTIONS = [
  { key: null, label: 'Not specified' },
  { key: 30, label: '30 min' },
  { key: 60, label: '1 hr' },
  { key: 90, label: '1.5 hr' },
  { key: 120, label: '2 hr' },
  { key: 180, label: '3 hr' },
];
export const EQUIPMENT_OPTIONS = [
  { key: null, label: 'Not specified' },
  { key: true, label: 'Equipment provided' },
  { key: false, label: 'Bring your own' },
];

export function durationLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes < 15) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} hr` : `${Math.round(h * 10) / 10} hr`;
}

// Short labelled facts for a card / detail, only for what the host really said.
export function practicalFacts(g) {
  const out = [];
  if (g?.equipment_provided === true) out.push('🎾 Equipment provided');
  else if (g?.equipment_provided === false) out.push('🎒 Bring your own equipment');
  const d = durationLabel(g?.duration_minutes);
  if (d) out.push(`⏱️ About ${d}`);
  return out;
}

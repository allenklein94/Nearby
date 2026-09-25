import { ageRangeLabel } from './suitedAges';
import { formatLabel, formatIcon } from '../constants/activityFormat';
import { skillLabel } from '../constants/skillLevel';
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

export const GENRE_OPTIONS = [
  { key: null, label: 'Not specified' },
  { key: 'rock', label: 'Rock' }, { key: 'pop', label: 'Pop' }, { key: 'jazz', label: 'Jazz' }, { key: 'blues', label: 'Blues' },
  { key: 'country', label: 'Country' }, { key: 'hip_hop', label: 'Hip-Hop' }, { key: 'electronic', label: 'Electronic' },
  { key: 'classical', label: 'Classical' }, { key: 'folk', label: 'Folk' }, { key: 'latin', label: 'Latin' },
  { key: 'r_and_b', label: 'R&B' }, { key: 'open_mic', label: 'Open Mic' },
];
// Genre is asked only for a music gathering; the tags below are real canonical Entertainment tags.
export const MUSIC_TAGS = ['Music', 'Live Music', 'Concerts', 'DJs', 'Karaoke'];
export const isMusicTag = (tag) => MUSIC_TAGS.includes(tag);
export const genreLabel = (key) => GENRE_OPTIONS.find((o) => o.key && o.key === key)?.label ?? null;

// Accessibility and family features a HOST declares on a gathering (owner items 49/50): a closed list, stored as
// `gatherings.features`, shown only when the host said them, never inferred. Keys are the same ones the business vocabulary uses.
export const GATHERING_FEATURE_OPTIONS = [
  { key: 'wheelchair_accessible', label: 'Wheelchair accessible', icon: '♿' },
  { key: 'accessible_parking', label: 'Accessible parking', icon: '🅿️' },
  { key: 'accessible_restroom', label: 'Accessible restroom', icon: '🚻' },
  { key: 'service_animal_friendly', label: 'Service animal friendly', icon: '🦮' },
  { key: 'quiet', label: 'Quiet environment', icon: '🤫' },
  { key: 'kid_friendly', label: 'Kids welcome', icon: '🧒' },
  { key: 'stroller_friendly', label: 'Stroller friendly', icon: '👶' },
  { key: 'family_seating', label: 'Family seating', icon: '🪑' },
  { key: 'outdoor_seating', label: 'Outdoor seating', icon: '🌤️' },
];
export const GATHERING_FEATURE_KEYS = GATHERING_FEATURE_OPTIONS.map((o) => o.key);
// Drops anything outside the closed list and duplicates (the database CHECK enforces the same).
export const cleanFeatures = (arr) => [...new Set(Array.isArray(arr) ? arr : [])].filter((k) => GATHERING_FEATURE_KEYS.includes(k));
export function toggleFeature(list, key) {
  const cur = cleanFeatures(list);
  return cur.includes(key) ? cur.filter((k) => k !== key) : cleanFeatures([...cur, key]);
}

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
  const genre = genreLabel(g?.genre);
  if (genre) out.unshift(`🎵 ${genre}`);
  // Item 66: the host-declared format leads (how it runs), never inferred from the category.
  const fmt = formatLabel(g?.format);
  if (fmt) out.unshift(`${formatIcon(g.format)} ${fmt}`);
  // Item 67: a declared skill level, right after the format.
  const skill = skillLabel(g?.skill_level);
  if (skill) out.splice(fmt ? 1 : 0, 0, `🎯 ${skill}`);
  const ages = ageRangeLabel(g?.suited_age_min, g?.suited_age_max);
  if (ages) out.push(`🧒 ${ages}`);
  for (const k of cleanFeatures(g?.features)) {
    const o = GATHERING_FEATURE_OPTIONS.find((x) => x.key === k);
    if (o) out.push(`${o.icon} ${o.label}`);
  }
  return out;
}

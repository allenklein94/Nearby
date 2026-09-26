// Genre matching for typed asks (owner decision 2026-09-26, after item 79; LOCKED). "rock show tonight" lifts gatherings whose
// HOST DECLARED Rock (`gatherings.genre`, the closed GENRE_OPTIONS list, music tags only). Same pattern as format / skill /
// intensity / effort:
//   - the genre comes only from the person's own typed words, by deterministic phrase rules (never AI), and only from the
//     gathering's declared `genre` on the result side (never inferred from its title, description, venue or tag);
//   - ranking only: a declared match lifts modestly; a different or undeclared genre is neutral; nothing is removed;
//   - no genre category, no genre + activity category, no Discover filter, no preference screen, nothing stored;
//   - never in a business payload, demand signal or people discovery;
//   - the reason reads "Related to your interest in Rock" (the typed request), never "you like" / "because you like".
// "concert tonight" names no genre and changes nothing. Techno is its own declared genre (migration 20270215): "techno",
// "techno music", "techno night" -> Techno. Words without their own key map onto a declared one only where listed below
// (house music / deep house / EDM -> Electronic, rap -> Hip-Hop, salsa / reggaeton -> Latin); bare "house" maps to nothing.
import { GENRE_OPTIONS, genreLabel } from '../utils/gatheringPractical';

export const GENRE_KEYS = GENRE_OPTIONS.filter((o) => o.key).map((o) => o.key);

// Ambiguous words (pop, country, house, latin) count only next to a music word; rock never as rock climbing / rock wall.
const MUSIC = '(music|show|shows|concert|concerts|gig|gigs|band|bands|night|set|dj|live|festival|jam|bar)';
const ASK = [
  { key: 'rock', re: /\b(punk\s+|hard\s+|indie\s+|classic\s+|alt(ernative)?\s+)?rock\b(?!\s*(climb\w*|wall|gym|pool\w*|hound\w*|paper))(?<!\blittle\s+rock)/i },
  { key: 'jazz', re: /\bjazz\b/i },
  { key: 'blues', re: /\bblues\b/i },
  { key: 'country', re: new RegExp(`\\bcountry\\s+${MUSIC}\\b|\\bcountry\\s+(western|line\\s+danc\\w*)\\b`, 'i') },
  { key: 'hip_hop', re: /\bhip[\s-]?hop\b|\brap\s+(show|concert|battle|night|music)\b/i },
  { key: 'techno', re: /\btechno\b/i },
  { key: 'electronic', re: /\bedm\b|\belectronic\s+music\b|\b(deep|tech)\s+house\b|\bhouse\s+music\b|\brave\b/i },
  { key: 'classical', re: /\bclassical\b|\bsymphony\b|\borchestra\b/i },
  { key: 'folk', re: /\bfolk\b/i },
  { key: 'latin', re: new RegExp(`\\blatin\\s+${MUSIC}\\b|\\bsalsa\\s+(night|music|dancing|band)\\b|\\breggaeton\\b`, 'i') },
  { key: 'r_and_b', re: /\br\s*&\s*b\b|\brnb\b|\br\s+and\s+b\b|\brhythm\s+and\s+blues\b/i },
  { key: 'pop', re: new RegExp(`\\bpop\\s+${MUSIC}\\b|\\bk-?pop\\b`, 'i') },
  { key: 'open_mic', re: /\bopen[\s-]?mic\b/i },
];

// Genre keys the typed words name, in list order; [] when none.
export function genresFromText(text) {
  if (typeof text !== 'string' || !text) return [];
  const found = ASK.filter((a) => a.re.test(text)).map((a) => a.key);
  // "rhythm and blues" is R&B, not also Blues.
  return found.includes('r_and_b') && /\brhythm\s+and\s+blues\b/i.test(text) ? found.filter((k) => k !== 'blues') : found;
}

export const GENRE_FIT_POINTS = 2;
export const genreReason = (key) => {
  const label = genreLabel(key);
  return label ? `Related to your interest in ${label}` : null;
};

// A candidate's genre is only its declared `genre` (carried from `gatherings.genre`); nothing else is read.
export function genreFit(candidate, asked) {
  const g = candidate?.genre;
  if (!Array.isArray(asked) || !asked.length || !GENRE_KEYS.includes(g) || !asked.includes(g)) return { delta: 0, reason: null };
  return { delta: GENRE_FIT_POINTS, reason: genreReason(g) };
}

export function applyGenreToCandidates(candidates, asked) {
  if (!Array.isArray(asked) || !asked.length) return candidates;
  return candidates.map((c) => {
    const { delta, reason } = genreFit(c, asked);
    // The typed genre is explicit current intent (signal tier 1), so its reason leads, except over the Full / waitlist line.
    return delta ? { ...c, score: (c.score ?? 0) + delta, subtitle: c.isFull && c.subtitle ? c.subtitle : reason } : c;
  });
}

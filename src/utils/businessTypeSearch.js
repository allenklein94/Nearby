import { CATEGORY_GROUPS } from '../constants/gatheringCategories';

// Business signup: "What type of business are you?" is a search, not a four-level tree. Typing "coffee" offers
// "Food & Drink -> Coffee"; tapping one sets the business's major AND its specific type in one go. Rule-based over the
// canonical taxonomy (leaf tags, including business-only ones, and the 19 majors); nothing is invented and a business
// that matches nothing falls through to the existing "describe it in your own words" path.
const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function searchBusinessTypes(query, limit = 6) {
  const q = norm(query);
  if (q.length < 2) return [];
  const out = [];
  for (const g of CATEGORY_GROUPS) {
    const gl = norm(g.label);
    for (const tag of [...g.tags, ...(g.businessOnlyTags ?? [])]) {
      const t = norm(tag);
      const rank = t === q ? 0 : t.startsWith(q) ? 1 : t.split(' ').some((w) => w.startsWith(q)) ? 2 : t.includes(q) ? 3 : -1;
      if (rank >= 0) out.push({ rank, category: g.key, subcategory: tag, label: tag, pathLabel: `${g.label} → ${tag}` });
    }
    const groupRank = gl.startsWith(q) ? 1 : gl.split(' ').some((w) => w.startsWith(q)) ? 2 : -1;
    if (groupRank >= 0) out.push({ rank: groupRank + 3, category: g.key, subcategory: null, label: g.label, pathLabel: g.label });
  }
  const seen = new Set();
  return out
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .filter((r) => { const k = `${r.category}|${r.subcategory}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit)
    .map(({ rank, ...r }) => r);
}

// Item 80: one empty-state language. An empty section explains itself in two parts -- WHAT is empty (title, plain and
// specific, never "No data") and WHAT TO DO or what will appear (body). Bodies are true statements about how the section
// fills; the tappable next step stays with the screen that owns the destination (Item 56, no dead ends). Add a new empty
// state here first; `emptyStateLanguage.test.js` rejects database voice and unknown ids.
export const EMPTY_STATES = {
  plans_upcoming: { title: 'No upcoming plans', body: 'Find something nearby or start something new.' },
  plans_hosting: { title: "You're not hosting anything", body: 'Start a gathering and people nearby can join.' },
  plans_past: { title: 'No past plans yet', body: "Gatherings you've been to will be kept here." },
  activity: { title: 'Nothing new yet', body: 'Notices, crossed paths and other activity will show up here.' },
  business_opportunities: { title: 'No new opportunities', body: "We'll show requests from nearby customers here." },
  business_stats: { title: 'No activity to show yet', body: 'Views, followers and redemptions appear here once customers start finding your business.' },
  places_category: { title: 'Nothing nearby in this category', body: 'Try another category or widen what you are looking for.' },
  places_search: { title: 'No places match "{query}"', body: 'Try a different word, or clear the search.' },
};

export function emptyCopy(id, vars = {}) {
  const e = EMPTY_STATES[id];
  if (!e) return null;
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
  return { title: fill(e.title), body: fill(e.body) };
}

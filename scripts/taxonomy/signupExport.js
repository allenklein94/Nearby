// The static business signup page (docs/business.html) embeds a copy of the taxonomy (APPLY_TAGS) and of the synonym
// table (APPLY_SYNONYMS). Pure helpers shared by the regenerate script, the live staleness check and the Jest tests.
function embedded(html, name) {
  const m = html.match(new RegExp(`var ${name} = (\\{.*\\});`));
  return m ? JSON.parse(m[1]) : null;
}

function renderTags(groups) {
  const out = {};
  for (const g of groups) out[g.key] = [...g.tags, ...(g.businessOnlyTags ?? [])];
  return out;
}

function renderSynonyms(seedRows) {
  const out = {};
  for (const r of seedRows) (out[r.phrase] = out[r.phrase] || []).push(r.tag);
  return out;
}

function regenerate(html, groups, seedRows) {
  const tags = `var APPLY_TAGS = ${JSON.stringify(renderTags(groups)).replace(/","/g, '", "').replace(/":\[/g, '": [').replace(/\],"/g, '], "')};`;
  const syns = `var APPLY_SYNONYMS = ${JSON.stringify(renderSynonyms(seedRows))};`;
  return html.replace(/var APPLY_TAGS = \{.*\};/, () => tags).replace(/var APPLY_SYNONYMS = \{.*\};/, () => syns);
}

// Compares the export with the SERVER taxonomy (get_category_taxonomy()). Stale = a live category missing or in another
// group, or the export offering a retired category or a former name.
function staleness(html, snapshot) {
  const exported = embedded(html, 'APPLY_TAGS') ?? {};
  const place = new Map();
  for (const [group, tags] of Object.entries(exported)) for (const t of tags) place.set(t, group);
  const live = (snapshot?.tags ?? []).filter((t) => !t.retired);
  const retired = new Set((snapshot?.tags ?? []).filter((t) => t.retired).map((t) => t.tag));
  const former = new Set((snapshot?.former_names ?? []).map((f) => f.name));
  const missing = live.filter((t) => !place.has(t.tag)).map((t) => t.tag);
  const wrongGroup = live.filter((t) => place.has(t.tag) && place.get(t.tag) !== t.group_key)
    .map((t) => ({ tag: t.tag, exported: place.get(t.tag), server: t.group_key }));
  const offersRetired = [...place.keys()].filter((t) => retired.has(t));
  const offersFormerName = [...place.keys()].filter((t) => former.has(t) && !live.some((l) => l.tag === t));
  return { stale: missing.length + wrongGroup.length + offersRetired.length + offersFormerName.length > 0,
    missing, wrongGroup, offersRetired, offersFormerName, serverVersion: snapshot?.version ?? null };
}

module.exports = { embedded, renderTags, renderSynonyms, regenerate, staleness };

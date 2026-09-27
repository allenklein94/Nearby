// Typed-ask instrumentation (2026-09-27, owner item 105, live-loop milestone). OBSERVABILITY ONLY: it never changes a score, an
// order, a filter or what is shown. For every typed ask on Home or Discover it records, internally (no client read, nothing
// business-facing): the structured interpretation the ranking path actually used, the results in the order the screen actually
// shows them, and for each result the canonical signal codes that moved its score (with the delta each contributed). No raw
// typed text is ever part of it: every field comes from a closed vocabulary or is a number/boolean.
//
// Pure module (no network): the trace, the codes, the sanitizer and the display layout both screens render from. The writer is
// services/typedAskAudit.js.

// Bump whenever what is recorded (fields, codes, layout) changes, so rows stay comparable.
export const TYPED_ASK_AUDIT_VERSION = 'typed-ask-audit-v3'; // v2: results ordered by the tier framework; business/perk/community base split into named codes. v3 (item 118): eligibility runs before ranking; `exclusions` = removals by eligibility rule

// Every code a score contribution or a removal can carry. `class` is what analysis aggregates by ("how often did an explicit
// requirement contribute", "how often did weather"...). A pass that is traced must use one of these; a test keeps resolveIntent's
// trace calls inside this list. Adding a pass = one row here + one trace call.
export const SIGNAL_CODES = {
  // base score, set by each result type's own scorer before any ask-specific pass
  base: 'base',
  base_interest_match: 'personal_interest',
  base_close_distance: 'proximity',
  base_today: 'time',
  base_title_mention: 'explicit_match',
  base_price_party: 'explicit_requirement',
  base_category_match: 'explicit_match',
  base_subcategory: 'explicit_match',
  base_secondary_category: 'explicit_match',
  base_attribute_match: 'explicit_preference',
  base_activity_fit: 'explicit_preference',
  base_occasion_fit: 'explicit_preference',
  base_party_type_fit: 'explicit_requirement',
  base_own_network: 'social',
  base_who_for: 'social',
  base_availability: 'availability',
  base_package: 'availability',
  base_occasion_offering: 'business_opportunity',
  base_hobby_link: 'personal_interest',
  base_past_plan: 'personal_interest',
  base_followed: 'personal_interest',
  base_area: 'proximity',
  // ask-specific passes in resolveIntent, in the order they run
  weather: 'weather',
  price_budget: 'explicit_requirement',
  format: 'explicit_requirement',
  skill_level: 'explicit_requirement',
  genre: 'explicit_preference',
  intensity: 'explicit_preference',
  effort: 'explicit_preference',
  social_context: 'explicit_preference',
  distance_willingness: 'explicit_requirement',
  transport_mode: 'explicit_preference',
  time_budget: 'explicit_requirement',
  clock_window: 'explicit_requirement',
  energy: 'explicit_preference',
  capabilities: 'explicit_requirement',
  commitment: 'explicit_preference',
  spontaneity: 'time',
  open_ended: 'context',
  category_narrow: 'explicit_requirement',
  declared_features: 'explicit_requirement',
  vibe: 'explicit_preference',
  session_intent: 'personal_interest', // item 114: history lift removed/capped when the ask states what it wants now
  quality_depth: 'explicit_preference',
  date_place: 'explicit_preference',
  date_tag: 'explicit_preference',
  preferred_category: 'explicit_preference',
  ask_facets: 'explicit_requirement',
  open_now: 'availability',
  // removals (counted per ask, never per person or business)
  dedupe: 'dedupe',
  compatibility: 'explicit_requirement',
};

// Passes whose contribution is deliberately NOT recorded because it would disclose a stated sensitive need or a child's age (the
// approved logging strips those; nothing here may add them back). The baseline is re-read after them, so no other code absorbs
// their delta; the unexplained remainder shows only as final score minus the recorded parts.
export const UNRECORDED_PASSES = ['dietary', 'suited_ages'];

const TOKEN = /^[A-Za-z0-9 &_'.:+/$-]{1,40}$/; // $ for price tiers ($, $$...)
const SECTION = /^[a-z_]{1,20}(:[a-z_]{1,40})?$/;
const TYPE = /^[a-z_]{1,40}$/;
const UUID = /^[0-9a-f-]{36}$/;
// The refinement chips (utils/askRefinements.js); the server CHECK carries the same list.
export const REFINEMENT_KEYS = ['friends', 'date', 'solo', 'under_25', 'category']; // 'category' = a Browse category narrowing the ask (item 108)
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const ID = /^[A-Za-z0-9_:.-]{1,64}$/;

const keyOf = (c) => (c?.type && c?.id != null ? `${c.type}:${c.id}` : null);
const num = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0);

// Records, per candidate, the score change each named pass made. Read-only: it never writes to a candidate or the list, and every
// method swallows its own errors so a bug here can never break a search.
// `removed`: Stage 1's removals by eligibility rule (utils/askEligibility.js), recorded as this ask's exclusions.
export function createScoreTrace(initial, { removedBeforeStart = 0, removed = null } = {}) {
  return diffTrace(initial, { removedBeforeStart, removed });
}

// The RANKING ledger (constants/signalPriority.js): the same per-pass diff, a separate instance so the audit can never change an
// order. It also accepts UNRECORDED_PASSES (a stated dietary need / child's age must still move the order); nothing reads it into
// the audit, so they stay unrecorded.
export function createRankLedger(initial) {
  return diffTrace(initial, { extraCodes: UNRECORDED_PASSES });
}

function diffTrace(initial, { removedBeforeStart = 0, removed = null, extraCodes = [] } = {}) {
  const known = (code) => !!SIGNAL_CODES[code] || extraCodes.includes(code);
  const last = new Map();
  const signals = new Map();
  const exclusions = {};
  const safe = (fn) => { try { fn(); } catch (e) { /* observability must never break ranking */ } };
  const read = (list) => {
    last.clear();
    for (const c of Array.isArray(list) ? list : []) {
      const k = keyOf(c);
      if (k) last.set(k, num(c.score ?? 0));
    }
  };
  safe(() => {
    if (removedBeforeStart > 0) exclusions.dedupe = removedBeforeStart;
    for (const [code, n] of Object.entries(removed ?? {})) if (Number.isInteger(n) && n > 0) exclusions[code] = n;
    for (const c of Array.isArray(initial) ? initial : []) {
      const k = keyOf(c);
      if (!k) continue;
      const parts = Array.isArray(c.baseSignals) ? c.baseSignals.filter((p) => known(p?.code) && p.delta) : [];
      const explained = parts.reduce((s, p) => s + p.delta, 0);
      const rest = num((c.score ?? 0) - explained);
      signals.set(k, [...parts.map((p) => ({ code: p.code, delta: num(p.delta) })), ...(rest ? [{ code: 'base', delta: rest }] : [])]);
    }
    read(initial);
  });
  return {
    step(code, list) {
      safe(() => {
        if (!known(code)) return;
        const seen = new Set();
        for (const c of Array.isArray(list) ? list : []) {
          const k = keyOf(c);
          if (!k) continue;
          seen.add(k);
          const before = last.get(k);
          const delta = before == null ? 0 : num((c.score ?? 0) - before);
          if (delta) {
            if (!signals.has(k)) signals.set(k, []);
            signals.get(k).push({ code, delta });
          }
        }
        const removed = [...last.keys()].filter((k) => !seen.has(k)).length;
        if (removed) exclusions[code] = (exclusions[code] ?? 0) + removed;
        read(list);
      });
    },
    // Re-read the baseline without recording (UNRECORDED_PASSES).
    rebase(list) { safe(() => read(list)); },
    signalsFor(c) { return signals.get(keyOf(c)) ?? []; },
    exclusions() { return { ...exclusions }; },
  };
}

// What resolveIntent holds: a trace that can never throw into ranking, even if creating or using it fails.
const NOOP_TRACE = { step() {}, rebase() {}, signalsFor: () => [], exclusions: () => ({}) };
export function guardTrace(make) {
  let t;
  try { t = make(); } catch (e) { return NOOP_TRACE; }
  if (!t) return NOOP_TRACE;
  const wrap = (name, fallback) => (...args) => { try { return t[name](...args); } catch (e) { return fallback; } };
  return { step: wrap('step'), rebase: wrap('rebase'), signalsFor: wrap('signalsFor', []), exclusions: wrap('exclusions', {}) };
}

// The interpretation fields that may be recorded. Anything else is dropped; values must be closed-vocabulary tokens, numbers or
// booleans (or arrays / one level of objects of those). Dietary needs, accessibility needs, child ages, children/pets facts and
// any words are never among them.
export const INTERPRETATION_FIELDS = [
  'intent', 'category', 'category_group', 'preferred_category', 'date_tag', 'cuisine', 'occasion', 'combination', 'multi_part',
  'date_window', 'when_preset', 'party_size', 'party_size_stated', 'party_type', 'price_level', 'budget_max', 'attributes',
  'energies', 'formats', 'skill_levels', 'genres', 'intensity', 'effort', 'social_context', 'meet_new_people',
  'distance_willingness', 'search_widened', 'transport_mode', 'time_budget_minutes', 'clock_window', 'date_anchor',
  'commitment', 'spontaneity', 'open_now', 'open_now_chip', 'environment', 'environment_required', 'exclude', 'avoid_pricey',
  'open_ended_groups', 'vibes_avoid', 'narrow_group',
];

function cleanValue(v, depth = 0) {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? num(v) : null;
  if (typeof v === 'string') return TOKEN.test(v) ? v : null;
  if (Array.isArray(v)) {
    const out = v.slice(0, 30).map((x) => cleanValue(x, depth + 1)).filter((x) => x != null && typeof x !== 'object');
    return out.length ? out : null;
  }
  if (typeof v === 'object' && depth === 0) {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (!KEY.test(k)) continue;
      const cv = cleanValue(x, depth + 1);
      if (cv != null && typeof cv !== 'object') out[k] = cv;
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

// A stated access need is never recorded (the approved search logs strip it; utils/sensitiveNeeds.js). Dietary needs are not a
// field at all. `quiet` stays: it is a vibe as much as an access need, and it was already an ordinary ranked quality.
export const UNRECORDED_ATTRIBUTE_KEYS = ['wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly'];

export function sanitizeInterpretation(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const field of INTERPRETATION_FIELDS) {
    const given = field === 'attributes' && Array.isArray(raw.attributes)
      ? raw.attributes.filter((a) => !UNRECORDED_ATTRIBUTE_KEYS.includes(a))
      : raw[field];
    const v = cleanValue(given);
    if (v != null) out[field] = v;
  }
  return out;
}

// ---- What each screen actually shows, in order. Both screens RENDER from these, so the record cannot drift from the screen. ----

// Home: the flat list minus what the experience claimed, grouped by type in first-seen order when there are 2+ types.
export function remainingIntentItems(result) {
  const claimedIds = result?.experience?.claimedIds ?? [];
  const items = Array.isArray(result?.items) ? result.items : [];
  return claimedIds.length > 0 ? items.filter((i) => !claimedIds.includes(i.id)) : items;
}

export function groupIntentResultsByType(items) {
  const order = [];
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.type)) {
      groups.set(item.type, []);
      order.push(item.type);
    }
    groups.get(item.type).push(item);
  }
  return order.map((type) => ({ type, items: groups.get(type) }));
}

function experienceRows(experience) {
  if (!experience) return [];
  const rows = [];
  for (const b of experience.bundles ?? []) rows.push({ item: b, section: 'bundle' });
  for (const comp of experience.components ?? []) for (const item of comp.items ?? []) rows.push({ item, section: `component:${comp.key}` });
  return rows;
}

// surface 'home' | 'discover'. Returns [{ item, section, position }] (position 1 = first on screen).
export function displayedIntentResults(surface, result) {
  if (!result) return [];
  let rows = [];
  if (surface === 'home') {
    if (!(Array.isArray(result.items) && result.items.length)) return [];
    rows = experienceRows(result.experience);
    const remaining = remainingIntentItems(result);
    const grouped = new Set(remaining.map((i) => i.type)).size >= 2 && !(remaining.length === 1 && remaining[0].type === 'friend_discovery');
    const flat = grouped ? groupIntentResultsByType(remaining).flatMap((g) => g.items) : remaining;
    rows.push(...flat.map((item) => ({ item, section: grouped ? `type:${item.type}` : 'list' })));
  } else if (surface === 'discover') {
    if (result.outcome !== 'results') return [];
    rows = result.experience ? experienceRows(result.experience) : (result.items ?? []).map((item) => ({ item, section: 'list' }));
  }
  return rows.map((r, i) => ({ ...r, position: i + 1 }));
}

// The one payload shape the writer sends. `audit` = what resolveIntent returned ({ interpretation, trace }); null for the
// community / business-partner paths, which record the interpretation they had and the shown ids only.
export function buildTypedAskSnapshot({ id, surface, submissionId = null, outcome, audit = null, displayed = [], interpretation = null, refinement = null }) {
  const trace = audit?.trace ?? null;
  const results = displayed.slice(0, 50).map(({ item, section, position }) => {
    const rid = item?.id != null ? String(item.id) : null;
    return {
      position,
      section: SECTION.test(section ?? '') ? section : 'list',
      result_type: TYPE.test(item?.type ?? '') ? item.type : 'unknown',
      result_id: rid && ID.test(rid) ? rid : null,
      partner_id: typeof item?.partnerId === 'string' && UUID.test(item.partnerId) ? item.partnerId : null,
      score: Number.isFinite(item?.score) ? num(item.score) : null,
      signals: trace ? trace.signalsFor(item).slice(0, 40) : [],
    };
  });
  return {
    id,
    surface,
    rules_version: TYPED_ASK_AUDIT_VERSION,
    submission_id: submissionId ?? null,
    outcome: /^[a-z_]{1,40}$/.test(outcome ?? '') ? outcome : null,
    interpretation: sanitizeInterpretation(interpretation ?? audit?.interpretation ?? {}),
    candidate_count: Number.isInteger(audit?.candidateCount) ? audit.candidateCount : null,
    // A refinement chip (item 107): which chip, applied or removed, and the ORIGINAL ask's snapshot it refines.
    ...(refinement && REFINEMENT_KEYS.includes(refinement.key) && ['applied', 'removed'].includes(refinement.action) ? {
      refinement_key: refinement.key,
      refinement_action: refinement.action,
      parent_snapshot_id: typeof refinement.parentSnapshotId === 'string' && UUID.test(refinement.parentSnapshotId) ? refinement.parentSnapshotId : null,
    } : {}),
    exclusions: trace ? trace.exclusions() : {},
    results,
  };
}

// The shown position of a result (1-based) in a displayed layout, for linking a tap to its snapshot row; null when not shown.
export function displayedPosition(displayed, item) {
  const row = (Array.isArray(displayed) ? displayed : []).find((r) => r.item?.type === item?.type && r.item?.id === item?.id);
  return row ? row.position : null;
}

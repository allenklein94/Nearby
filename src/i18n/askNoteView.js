// The typed-ask caption line ("Looking across Food & Drink · Keeping it before 3 PM · Rain expected tonight — indoor options are
// higher") in the person's language (2026-10-02, owner). The resolver keeps building the line in canonical English (the builders
// are the one source of that wording; fixtures and the audit read it); this view reads each " · " part back into a template key +
// values and renders `ui.askNotes.<key>` in the person's language: group names through categoryNames, clock times and durations
// through i18n/format, weekdays and list joins from the strings. Every English template is checked against its builder by test,
// so a builder's wording can never drift from what this view recognizes. A part it does not recognize is left as it was.
import { translate, DEFAULT_LANGUAGE } from './translate';
import { groupName } from './categoryNames';
import { localDuration, localClock } from './format';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { clockLabel } from '../constants/clockWindow';
import { timeBudgetCaption } from '../constants/timeBudget';
import { OPEN_NOW_CAPTION } from '../utils/operatingStatus';
import { NEED_CAPTION } from '../utils/needAsk';
import { spontaneityCaption } from '../constants/spontaneity';
import { DISTANCE_WILLINGNESS } from '../constants/distanceWillingness';
import { TRANSPORT_MODES } from '../constants/transportMode';

const t = (lang, key, vars) => translate(lang, `ui.askNotes.${key}`, vars);
const en = (key) => translate(DEFAULT_LANGUAGE, `ui.askNotes.${key}`);

// ---- fixed sentences, read from the builders themselves ----
function fixedMap() {
  const m = new Map([[OPEN_NOW_CAPTION, 'openNow'], [NEED_CAPTION, 'need']]);
  for (const k of ['now', 'next_hours', 'plan_ahead', 'this_week', 'no_rush']) m.set(spontaneityCaption(k), `spont.${k}`);
  for (const d of DISTANCE_WILLINGNESS) if (d.caption) m.set(d.caption, `dist.${d.key}`);
  for (const mode of TRANSPORT_MODES) if (mode.caption) m.set(mode.caption, `mode.${mode.key}`);
  m.set(en('weatherUnknown'), 'weatherUnknown');
  return m;
}

// ---- value maps (English text -> canonical value) ----
const GROUP_LABELS = new Map(CATEGORY_GROUPS.map((g) => [g.label, g.key]));
let clockMap = null;
const clocks = () => {
  if (!clockMap) { clockMap = new Map(); for (let m = 0; m <= 24 * 60; m += 1) { const l = clockLabel(m); if (l && !clockMap.has(l)) clockMap.set(l, m); } }
  return clockMap;
};
let durMap = null;
const durations = () => {
  if (!durMap) {
    durMap = new Map();
    const prefix = 'Picking things that fit in about ';
    for (let m = 1; m <= 24 * 60; m += 1) { const c = timeBudgetCaption(m); if (c && !durMap.has(c.slice(prefix.length))) durMap.set(c.slice(prefix.length), m); }
  }
  return durMap;
};
const OUT_KEYS = ['alcohol', 'outdoor', 'indoor', 'crowded', 'unsaid', 'pricey', 'children', 'pets', 'group', 'indoor_only', 'outdoor_only', 'booking', 'other'];
const keyedEnglish = (prefix, keys) => new Map(keys.map((k) => [en(`${prefix}.${k}`), k]));
const PLAN_WHAT = ['date_night', 'first_date', 'anniversary', 'birthday', 'plan'];
const PLAN_WHEN = ['tonight', 'today', 'tomorrow', 'weekend'];
const PLAN_PARTS = ['dinner', 'lunch', 'brunch', 'breakfast', 'eat', 'eating', 'food', 'bite', 'restaurant', 'supper', 'something_to_do', 'drinks', 'dessert'];
const WX = ['storm', 'snow', 'wet', 'heat', 'cold', 'outdoor'];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

// "A, B and C" against a map of known items (longest first; an item may itself contain ", " like "Arts, Culture & Learning").
function parseList(text, map) {
  const labels = [...map.keys()].sort((a, b) => b.length - a.length);
  const out = [];
  let rest = text;
  for (;;) {
    const hit = labels.find((l) => rest.startsWith(l));
    if (!hit) return null;
    out.push(map.get(hit));
    rest = rest.slice(hit.length);
    if (!rest) return out;
    if (rest.startsWith(', ')) rest = rest.slice(2);
    else if (rest.startsWith(' and ')) rest = rest.slice(5);
    else return null;
  }
}
function joinList(items, lang) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(t(lang, 'listSep'))}${t(lang, 'listAnd')}${items[items.length - 1]}`;
}

const durationText = (m, lang) => localDuration(m, lang) ?? translate(lang, 'vocab.units.minutes', { n: m, count: m });
const clockText = (m, lang) => localClock(m, lang, { words: true });

// One part -> { key, vars } with canonical values, or null.
export function parseAskNotePart(part) {
  const fixed = fixedMap().get(part);
  if (fixed) return { key: fixed, vars: {} };
  let m = /^Looking across (.+)$/.exec(part);
  if (m) { const groups = parseList(m[1], GROUP_LABELS); return groups ? { key: 'lookingAcross', vars: { groups } } : null; }
  m = /^Picking things that fit in about (.+)$/.exec(part);
  if (m) { const minutes = durations().get(m[1]); return minutes ? { key: 'timeBudget', vars: { minutes } } : null; }
  m = /^Keeping it between (.+) and (.+)$/.exec(part);
  if (m && clocks().has(m[1]) && clocks().has(m[2])) return { key: 'clockBetween', vars: { from: clocks().get(m[1]), to: clocks().get(m[2]) } };
  m = /^Keeping it (before|after) (.+)$/.exec(part);
  if (m && clocks().has(m[2])) return { key: m[1] === 'before' ? 'clockBefore' : 'clockAfter', vars: { time: clocks().get(m[2]) } };
  m = /^Planning (.+?): (.+)$/.exec(part);
  if (m) {
    const whats = keyedEnglish('planWhat', PLAN_WHAT);
    const whens = keyedEnglish('planWhenWord', PLAN_WHEN);
    let what = whats.get(m[1]);
    let when = null;
    if (!what) {
      const w = [...whens.keys()].find((x) => m[1].endsWith(` ${x}`));
      if (w) { what = whats.get(m[1].slice(0, -(w.length + 1))); when = whens.get(w); }
    }
    const partsMap = keyedEnglish('planPart', PLAN_PARTS);
    const parts = m[2].split(', then ').map((p) => partsMap.get(p));
    if (!what || parts.some((p) => !p)) return null;
    return { key: when ? 'planWhen' : 'plan', vars: { what, when, parts } };
  }
  m = /^Leaving out (.+)$/.exec(part);
  if (m) { const items = parseList(m[1], keyedEnglish('out', OUT_KEYS)); return items ? { key: 'leavingOut', vars: { items } } : null; }
  // weather: "<label> <when>[ — indoor|outdoor options are higher]"
  m = /^(.+?)(?: — (indoor|outdoor) options are higher)?$/.exec(part);
  if (m) {
    const fact = parseWeatherFact(m[1]);
    if (fact) return m[2] ? { key: `wxHigher.${m[2]}`, vars: fact } : { key: 'wxFact', vars: fact };
  }
  return null;
}

function parseWeatherFact(text) {
  for (const kind of WX) {
    const tpl = en(`wx.${kind}`); // "Rain expected {when}"
    const head = tpl.replace('{when}', '');
    if (!text.startsWith(head)) continue;
    const whenText = text.slice(head.length);
    for (const w of ['right_now', 'tonight', 'today', 'tomorrow', 'tomorrow_evening']) if (en(`wxWhen.${w}`) === whenText) return { kind, when: w };
    for (const d of WEEKDAYS) {
      const day = en(`wxDay.${d}`);
      if (whenText === day) return { kind, when: 'day', day: d };
      if (whenText === `${day} evening`) return { kind, when: 'day_evening', day: d };
    }
  }
  return null;
}

function renderWeatherFact({ kind, when, day }, lang) {
  const whenText = when === 'day' || when === 'day_evening'
    ? t(lang, `wxWhen.${when}`, { day: t(lang, `wxDay.${day}`) })
    : t(lang, `wxWhen.${when}`);
  return t(lang, `wx.${kind}`, { when: whenText });
}

export function renderAskNotePart({ key, vars }, lang) {
  switch (key) {
    case 'lookingAcross': return t(lang, key, { list: joinList(vars.groups.map((g) => groupName(g, lang, CATEGORY_GROUPS.find((x) => x.key === g)?.label)), lang) });
    case 'timeBudget': return t(lang, key, { duration: lang === DEFAULT_LANGUAGE ? [...durations()].find(([, v]) => v === vars.minutes)?.[0] : durationText(vars.minutes, lang) });
    case 'clockBetween': return t(lang, key, { from: lang === DEFAULT_LANGUAGE ? clockLabel(vars.from) : clockText(vars.from, lang), to: lang === DEFAULT_LANGUAGE ? clockLabel(vars.to) : clockText(vars.to, lang) });
    case 'clockBefore': case 'clockAfter': return t(lang, key, { time: lang === DEFAULT_LANGUAGE ? clockLabel(vars.time) : clockText(vars.time, lang) });
    case 'plan': case 'planWhen': return t(lang, key, {
      what: t(lang, `planWhat.${vars.what}`), when: vars.when ? t(lang, `planWhenWord.${vars.when}`) : '',
      parts: vars.parts.map((p) => t(lang, `planPart.${p}`)).join(t(lang, 'then')),
    });
    case 'leavingOut': return t(lang, key, { list: joinList(vars.items.map((k) => t(lang, `out.${k}`)), lang) });
    case 'wxFact': return renderWeatherFact(vars, lang);
    case 'wxHigher.indoor': case 'wxHigher.outdoor': return t(lang, key, { fact: renderWeatherFact(vars, lang) });
    default: return t(lang, key);
  }
}

// The whole line in the person's language. English (and anything unrecognized) is returned exactly as built.
export function localizeAskNote(line, language = DEFAULT_LANGUAGE) {
  if (!line || !language || language === DEFAULT_LANGUAGE) return line;
  return String(line).split(' · ').map((part) => {
    const parsed = parseAskNotePart(part);
    return parsed ? renderAskNotePart(parsed, language) : part;
  }).join(' · ');
}

// Owner idea "391" (2026-10-24): the per-object lifecycle matrix, a DEVELOPER REFERENCE generated from the app's own tables.
// Nothing here is a rule: every cell is either read from an authoritative table (LIFECYCLE, MOTION_TRIGGERS, the push
// constants) or produced by CALLING the real function (primaryActionFor & co.) with a sample object in that state. The
// sample objects are inputs only; a wrong answer would be the real function's answer, which is the point.
// The few crosswalks declared below (which screen / table belongs to which object) are labelled as such and checked for
// completeness by lifecycleMatrix.test.js. Anything the code cannot establish is listed under Flags, never guessed.
// Output: PRODUCT_AUDIT/LIFECYCLE_MATRIX.md (`npm run lifecycle-matrix` rewrites it; the test fails when it drifts).
import { LIFECYCLE, canDo, lifecycleClass, viewLabel, offerLifecycleState, requestLifecycleState, inviteLifecycleState, gatheringLifecycleState } from '../utils/objectLifecycle';
import { gatheringPrimaryAction, consumerOfferAction, offerPrimaryAction, opportunityPrimaryAction, inviteAction, businessPrimaryAction } from '../utils/primaryAction';
import { offerCard } from '../utils/offerPresentationEngine';
import { offerProgress, businessCardStatus, PROGRESS_STEPS } from '../utils/offerProgress';
import { requestNextStep } from '../utils/requestTimeline';
import { MOTION_TRIGGERS } from '../constants/motionLanguage';
import { DOMAIN_EVENTS, RECORD_ONLY_EVENTS } from '../constants/domainEvents';
import { notificationPriority } from '../constants/notificationTier';
import { notificationGroupOf } from '../constants/notificationPreferences';
import { notificationDestination } from '../navigation/notificationDestinations';
import { BOOKING_MODE_KEYS } from '../constants/bookingMode';

// A fixed clock, so the file is the same on every run.
export const NOW = new Date('2026-06-15T12:00:00Z');
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();
const HOUR = 3600e3;
const FUTURE = '2100-01-01T00:00:00Z';
const ME = 'viewer';

const S = {
  lifecycle: 'utils/objectLifecycle.js LIFECYCLE',
  gatheringCta: 'utils/primaryAction.js gatheringPrimaryAction',
  offerCta: 'utils/primaryAction.js consumerOfferAction',
  offerRow: 'utils/primaryAction.js offerPrimaryAction',
  opportunityCta: 'utils/primaryAction.js opportunityPrimaryAction',
  inviteCta: 'utils/primaryAction.js inviteAction',
  businessCta: 'utils/primaryAction.js businessPrimaryAction',
  offerCard: 'utils/offerPresentationEngine.js offerCard',
  progress: 'utils/offerProgress.js offerProgress / businessCardStatus',
  nextStep: 'utils/requestTimeline.js requestNextStep',
  viewLabel: 'utils/objectLifecycle.js lifecycleClass / viewLabel',
  motion: 'constants/motionLanguage.js MOTION_TRIGGERS',
  push: 'navigation/notificationDestinations.js + constants/notificationTier.js + constants/notificationPreferences.js',
};

// ---- crosswalks (declared, completeness-checked by the test) --------------------------------------------------------------
// The screen a push opens -> the lifecycle object that screen is the home of.
export const SCREEN_KIND = {
  GatheringDetail: 'gathering',
  BusinessRequestDetail: 'request',
  GroupPlan: 'group_plan',
  BusinessDashboard: 'opportunity',
};
// A stored table named in a MOTION_TRIGGERS state -> object kind, and its stored status -> the LIFECYCLE state.
export const TABLE_KIND = {
  business_request_offers: { kind: 'offer', state: (s) => s },
  business_requests: { kind: 'request', state: (s) => s },
  gathering_interest: { kind: 'gathering', state: (s) => ({ approved: 'upcoming_attending', pending: 'upcoming_requested', waitlisted: 'upcoming_waitlisted' })[s] ?? null },
};
// A domain event -> the object state it records (constants/domainEvents.js has no state field).
export const EVENT_STATE = {
  GATHERING_CREATED: ['gathering', 'upcoming_hosting'],
  INVITATION_SENT: ['invite', 'pending'],
  INVITATION_ACCEPTED: ['invite', 'accepted'],
  INVITATION_EXPIRED: ['invite', 'expired'],
  BUSINESS_REQUEST_SENT: ['request', 'open'],
  BUSINESS_OFFER_SENT: ['offer', 'offered'],
  BUSINESS_OFFER_ACCEPTED: ['offer', 'accepted'],
  OFFER_REDEEMED: ['offer', 'completed'],
  BUSINESS_OFFER_REVISED: ['offer', 'offered'],
};
// Push types the server no longer sends (their sending paths dropped; guard test named) but the client still routes, so an
// already-delivered notification opens somewhere. Checked by the test: the named guard exists and names the type.
export const RETIRED_PUSH = {
  momentum_streak_nudge: 'utils/streakNudgeRetired.test.js',
  first_mission_reminder: 'utils/engagementNudgesRetired.test.js',
  reward_tier_nudge: 'utils/engagementNudgesRetired.test.js',
};
// A CTA kind -> the LIFECYCLE action(s) that must allow it (checked for every probed state).
export const CTA_REQUIRES = {
  join: ['join', 'request'], interested: ['interested'], accept_offer: ['accept'], confirm_with_group: ['accept'],
  view_offer: ['accept'], send_offer: ['respond'], accept: ['accept'], dismiss: ['dismiss'],
};

// ---- sample objects per state (inputs only) -------------------------------------------------------------------------------
function gatheringSample(time, relation, extra = {}) {
  const status = { attending: 'approved', requested: 'pending', waitlisted: 'waitlisted' }[relation] ?? null;
  return {
    id: 'g1', host_id: relation === 'hosting' ? ME : 'host', visibility: 'public', is_public: true, capacity: 10, approvedCount: 1,
    scheduled_at: time === 'upcoming' ? at(2 * HOUR) : at(-30 * HOUR),
    attendees: status ? [{ user_id: ME, status }] : [], ...extra,
  };
}
const GATHERING_VARIANTS = [
  ['public, room', {}, {}],
  ['approval required', { requires_approval: true }, {}],
  ['full', { capacity: 3, approvedCount: 2 }, {}],
  ['viewer marked Interested', {}, { interestedIds: new Set(['g1']) }],
  ['low-commitment row (Trending)', {}, { lowCommitment: true, interestedIds: new Set() }],
  ['invite-only', { visibility: 'invite_only', is_public: false }, {}],
];
const offerSample = (status, extra = {}) => ({ id: 'o1', status, offer_type: 'standard', offer_price: 12, valid_until: FUTURE, business_requests: { status: 'open', expires_at: FUTURE }, ...extra });
const openRequest = { id: 'r1', status: 'open', expires_at: FUTURE };

const fmt = (a) => {
  if (!a) return '(none: surface default)';
  if (a.kind === 'status') return `status only: "${a.status}"`;
  return a.label ? `${a.kind}: "${a.label}"` : `${a.kind} (no label from the table)`;
};
const secondary = (a) => [
  ...(a?.alternatives ?? []).map((x) => `${x.kind}: "${x.label}"`),
  ...(a?.secondary ? [`${a.secondary.kind}: "${a.secondary.label}"`] : []),
].join(', ') || '';

// ---- per-kind rows -----------------------------------------------------------------------------------------------------------
function gatheringRows(flags) {
  const rows = [];
  for (const state of Object.keys(LIFECYCLE.gathering)) {
    if (state === 'unknown') {
      const a = gatheringPrimaryAction({ id: 'g1', host_id: 'host', attendees: [], scheduled_at: null }, ME, NOW.getTime());
      rows.push({ state, variant: 'no / unparseable date', cta: a, visible: a.status, source: S.gatheringCta });
      continue;
    }
    const [time, relation] = state.split('_');
    const variants = state === 'upcoming_none' ? GATHERING_VARIANTS : [['', {}, relation === 'interested' ? { interestedIds: new Set(['g1']) } : {}]];
    for (const [variant, extra, opts] of variants) {
      const g = gatheringSample(time, relation === 'interested' ? 'none' : relation, extra);
      const a = gatheringPrimaryAction(g, ME, NOW.getTime(), opts);
      rows.push({ state, variant, cta: a, probedState: a.state, visible: a.status, source: S.gatheringCta });
      if (a.state !== state && !(state.endsWith('_interested') && a.state === `${time}_none`)) {
        flags.push(['conflict', `gathering ${state}${variant ? ` (${variant})` : ''}: the CTA reports state "${a.state}"`, S.gatheringCta]);
      }
    }
  }
  if (rows.some((r) => r.state.endsWith('_interested'))) {
    flags.push(['ambiguous', 'gathering *_interested: card CTAs never report an Interested state; Interested is read from opts.interestedIds and the state reads *_none (same allowed actions upcoming; past_interested and past_none both View)', `${S.gatheringCta} (gatheringViewerState called without isInterested)`]);
  }
  return rows;
}

function offerRows() {
  const rows = [];
  for (const state of Object.keys(LIFECYCLE.offer)) {
    const o = offerSample(state);
    const a = consumerOfferAction(o, { request: openRequest, now: NOW });
    rows.push({ state, variant: 'customer, request open', cta: a, visible: [a.status, `card: ${offerCard(o, NOW)}`].filter(Boolean).join(' · '), row: offerPrimaryAction(o), source: `${S.offerCta}; ${S.offerCard}; ${S.offerRow}` });
  }
  const derived = [
    ['offered', 'another offer already booked', offerSample('offered'), { request: openRequest, hasWinner: true }],
    ['offered', 'request past its deadline', offerSample('offered'), { request: { ...openRequest, expires_at: at(-HOUR) } }],
    ['offered', 'group plan request', offerSample('offered'), { request: openRequest, isGroupPlanRequest: true }],
    ['offered', 'valid_until passed, not yet swept', offerSample('offered', { valid_until: at(-1) }), { request: openRequest }],
  ];
  for (const [state, variant, o, ctx] of derived) {
    const a = consumerOfferAction(o, { ...ctx, now: NOW });
    rows.push({ state, variant, cta: a, probedState: a.state, visible: [a.status, `card: ${offerCard(o, NOW)}`].filter(Boolean).join(' · '), source: S.offerCta });
  }
  return rows;
}

function opportunityRows() {
  const rows = [];
  const base = (status, req = { status: 'open', expires_at: FUTURE }) => ({ id: 'o1', status, valid_until: FUTURE, business_requests: req });
  const cases = [
    ['pending', 'request open', base('pending'), {}],
    ['pending', 'offer being reviewed', base('pending'), { inFlight: true }],
    ['pending', 'request expired', base('pending', { status: 'open', expires_at: at(-HOUR) }), {}],
    ...['offered', 'accepted', 'completed', 'declined', 'expired', 'cancelled', 'withdrawn'].map((s) => [s, '', base(s), {}]),
    ['offered', 'request expired, not yet swept', base('offered', { status: 'open', expires_at: at(-HOUR) }), {}],
  ];
  for (const [state, variant, o, ctx] of cases) {
    const a = opportunityPrimaryAction(o, { ...ctx, now: NOW });
    const p = offerProgress(o, NOW);
    rows.push({ state, variant, cta: a, visible: [a.status, `card status: ${businessCardStatus(o, NOW)}`, p ? `steps: ${PROGRESS_STEPS.map((s, i) => (i === p.current ? `[${s}]` : s)).join(' > ')}` : null].filter(Boolean).join(' · '), source: `${S.opportunityCta}; ${S.progress}` });
  }
  return rows;
}

function requestRows() {
  return Object.keys(LIFECYCLE.request).map((state) => {
    const req = { id: 'r1', status: state, expires_at: FUTURE };
    const none = requestNextStep(req, [], NOW);
    const some = requestNextStep(req, [offerSample('offered')], NOW);
    const group = requestNextStep({ ...req, group_plan_id: 'gp' }, [offerSample('offered')], NOW);
    const next = state === 'open' ? `Next: no live reply = "${none}"; replies = "${some}"; group = "${group}"` : (none ?? '(no Next line)');
    return { state, variant: '', cta: null, visible: next, source: S.nextStep };
  });
}

function inviteRows() {
  const rows = Object.keys(LIFECYCLE.invite).map((state) => {
    const inv = { status: state, inviteType: 'gathering', scheduledAt: at(2 * HOUR) };
    const a = inviteAction(inv, NOW);
    return { state, variant: '', cta: a, probedState: a.state, source: S.inviteCta };
  });
  const a = inviteAction({ status: 'pending', inviteType: 'gathering', scheduledAt: at(-HOUR) }, NOW);
  rows.push({ state: 'expired', variant: 'pending, gathering already started', cta: a, probedState: a.state, source: S.inviteCta });
  return rows;
}

function plainRows(kind, flags) {
  flags.push(['missing', `${kind}: no entry in primaryActionFor; its buttons are decided on its screen from canDo() (labels screen-local)`, 'screens/GroupPlanScreen.js']);
  return Object.keys(LIFECYCLE[kind]).map((state) => ({ state, variant: '', cta: null, visible: '', source: S.lifecycle }));
}

function businessRows() {
  const rows = [];
  for (const mode of BOOKING_MODE_KEYS) {
    for (const [variant, posting] of [['no hours / posting known', null], ['live posting now', { startsAt: at(-HOUR), endsAt: at(HOUR), remainingCapacity: 4 }]]) {
      const partner = { id: 'p1', name: 'Business', booking_mode: mode, latitude: 1, longitude: 1 };
      const a = businessPrimaryAction(partner, { posting, at: NOW });
      rows.push({ state: mode, variant, cta: a, source: S.businessCta });
    }
  }
  rows.push({ state: '(none declared)', variant: '', cta: businessPrimaryAction({ id: 'p1', name: 'Business' }, { at: NOW }), source: S.businessCta });
  return rows;
}

// ---- expiry: the real derivation functions at their exact boundaries ------------------------------------------------------
function expiry() {
  const g = (ms) => gatheringLifecycleState({ isHost: false, myStatus: 'approved', scheduled_at: at(ms) }, NOW);
  return {
    gathering: [`scheduled_at = now -> ${g(0)}; 1 ms earlier -> ${g(-1)} (derived, objectState.js gatheringTimeState; ends/check-in window: _gathering_ends_at, separate)`],
    offer: [`offered + valid_until = now -> ${offerLifecycleState(offerSample('offered', { valid_until: at(0) }), NOW)}; 1 ms later -> ${offerLifecycleState(offerSample('offered', { valid_until: at(1) }), NOW)} (derived before the hourly sweep stores it; objectLifecycle.js offerLifecycleState)`],
    opportunity: ['answerable only while its request is open before expires_at (objectLifecycle.js canRespondToOpportunity)'],
    request: [`open + expires_at = now -> ${requestLifecycleState({ status: 'open', expires_at: at(0) }, NOW)}; 1 ms later -> ${requestLifecycleState({ status: 'open', expires_at: at(1) }, NOW)} (objectLifecycle.js requestLifecycleState; expired allows reopen)`],
    invite: [`gathering invite, gathering started -> ${inviteLifecycleState({ status: 'pending', inviteType: 'gathering', scheduledAt: at(-1) }, NOW)}; community invite -> ${inviteLifecycleState({ status: 'pending', inviteType: 'community', scheduledAt: at(-1) }, NOW)} (objectState.js isSocialInviteExpired)`],
    group_plan: ['FLAG: stored by the server only; no client derivation'],
    group_participant: ['none'],
  };
}

// ---- notifications: every push type's destination, grouped by the object whose screen it opens -----------------------------
const ID_FIELDS = ['match_id', 'business_request_id', 'gathering_id', 'availability_id', 'partner_id', 'user_id', 'birthday_user_id', 'connected_user_id', 'proposal_id', 'request_id', 'offer_id', 'community_id', 'plan_id', 'owner_id', 'other_user_id', 'story_user_id'];
async function pushes(destinationSource) {
  const types = [...new Set([...destinationSource.matchAll(/case '(\w+)':/g)].map((m) => m[1]))].sort();
  const out = [];
  for (const type of types) {
    const screens = new Set();
    // Every single-id payload: a type whose destination depends on which id it carries shows each possibility.
    for (const f of ID_FIELDS) {
      const d = await notificationDestination({ type, [f]: 'x', target_type: 'gathering', target_id: 'x' }, { lookupAvailability: async () => ({ id: 'x', status: 'active' }) });
      if (d) screens.add(d.name === 'MainTabs' && d.params?.screen ? `${d.params.screen} tab` : d.name);
    }
    out.push({ type, screens: [...screens].sort(), priority: notificationPriority(type), group: notificationGroupOf(type) ?? '(none)' });
  }
  return out;
}

// ---- animation: MOTION_TRIGGERS whose stated trigger names a stored status ---------------------------------------------------
function motion() {
  const bound = [];
  const unbound = [];
  for (const [name, t] of Object.entries(MOTION_TRIGGERS)) {
    const hits = [];
    for (const [table, map] of Object.entries(TABLE_KIND)) {
      // The words after "<table>.status" up to the clause's end: quoted values ('accepted') or a bare a/b pair (fulfilled/merged).
      for (const m of t.state.matchAll(new RegExp(`\\b${table}\\.status\\b([^;:(]{0,80})`, 'g'))) {
        const values = [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
        if (!values.length) for (const x of m[1].matchAll(/\b(\w+)\/(\w+)\b/g)) values.push(x[1], x[2]);
        for (const v of values) {
          const s = map.state(v);
          if (s) hits.push([map.kind, s]);
        }
      }
    }
    if (/gathering_interested row/.test(t.state)) hits.push(['gathering', 'upcoming_interested']);
    if (hits.length) for (const [kind, state] of hits) bound.push({ name, kind, state, trigger: t.kind, actions: t.actions ?? [] });
    else unbound.push({ name, trigger: t.kind });
  }
  return { bound, unbound };
}

// ---- static scan: which LIFECYCLE actions any app code asks canDo() about ----------------------------------------------------
export function askedActions(sources) {
  const asked = new Set();
  for (const text of sources) {
    for (const m of text.matchAll(/canDo\(\s*'(\w+)'\s*,[\s\S]*?,\s*'(\w+)'\s*\)/g)) asked.add(`${m[1]}.${m[2]}`);
    // A local one-kind wrapper, e.g. GatheringDetail's `const can = (action) => … canDo('gathering', …, action)`, then can('edit').
    for (const w of text.matchAll(/const (\w+) = \(\w+\) => [^;\n]*canDo\(\s*'(\w+)'/g)) {
      for (const m of text.matchAll(new RegExp(`\\b${w[1]}\\(\\s*'(\\w+)'\\s*\\)`, 'g'))) asked.add(`${w[2]}.${m[1]}`);
    }
  }
  return asked;
}

// ---- build + checks ----------------------------------------------------------------------------------------------------------
export async function buildMatrix({ destinationSource, appSources }) {
  const flags = [];
  const kinds = {
    gathering: gatheringRows(flags),
    request: requestRows(),
    offer: offerRows(),
    opportunity: opportunityRows(),
    invite: inviteRows(),
    group_plan: plainRows('group_plan', flags),
    group_participant: plainRows('group_participant', flags),
    business: businessRows(),
  };
  flags.push(['missing', 'request: no entry in primaryActionFor; the request screen shows the reply cards (offer rows) and the Next line', S.nextStep]);

  // Every CTA must be allowed by LIFECYCLE in the state it was produced for.
  for (const kind of ['gathering', 'offer', 'invite']) {
    for (const r of kinds[kind]) {
      const need = CTA_REQUIRES[r.cta?.kind];
      if (!need) continue;
      const st = r.probedState && LIFECYCLE[kind][r.probedState] ? r.probedState : r.state;
      if (!need.some((x) => canDo(kind, st, x))) flags.push(['conflict', `${kind} ${st}: CTA "${r.cta.kind}" but LIFECYCLE allows none of ${need.join('/')}`, S.lifecycle]);
    }
  }
  // Derived display states not in LIFECYCLE.
  for (const r of kinds.offer) {
    if (r.probedState && !LIFECYCLE.offer[r.probedState]) flags.push(['info', `offer "${r.probedState}" (${r.variant}) is a derived display state, not in LIFECYCLE.offer`, S.offerCta]);
  }
  for (const r of kinds.offer) {
    if (r.variant === 'customer, request open' && r.cta?.kind === 'view' && !r.cta.status) flags.push(['ambiguous', `offer ${r.state}: the customer row shows View with no status word`, `${S.offerCta} OFFER_STATE_STATUS`]);
  }

  // LIFECYCLE actions no code asks about.
  const asked = askedActions(appSources);
  for (const [kind, states] of Object.entries(LIFECYCLE)) {
    const all = new Set(Object.values(states).flat());
    for (const action of [...all].sort()) {
      if (action === 'view') continue;
      if (!asked.has(`${kind}.${action}`)) flags.push(['info', `LIFECYCLE ${kind}.${action} is declared but no app code asks canDo('${kind}', …, '${action}'); screens decide it another way (e.g. isHost) or not at all`, S.lifecycle]);
    }
  }

  const push = await pushes(destinationSource);
  for (const p of push) if (p.screens.length === 0) flags.push(['missing', `push ${p.type}: no destination for any single-id payload`, 'navigation/notificationDestinations.js']);
  for (const [type, guard] of Object.entries(RETIRED_PUSH)) flags.push(['info', `push ${type} is retired (never sent; ${guard}) but still routed by the client for already-delivered notifications`, 'navigation/notificationDestinations.js']);
  for (const e of DOMAIN_EVENTS) if (!EVENT_STATE[e]) flags.push(['missing', `domain event ${e} has no state in EVENT_STATE`, 'qa/lifecycleMatrix.js']);

  const anim = motion();
  for (const b of anim.bound) {
    if (!LIFECYCLE[b.kind]?.[b.state]) flags.push(['conflict', `motion ${b.name} names ${b.kind} state "${b.state}", not in LIFECYCLE`, S.motion]);
  }
  flags.push(['missing', 'push sent per state: decided server-side (_dispatch_domain_event, triggers, RPCs); app code only knows where a push opens. Covered by journeys notificationEvents / notificationAction, not by this matrix', 'supabase (server)']);
  flags.push(['missing', 'transition target states: LIFECYCLE names the allowed actions; the state each one leads to is enforced by its server RPC and is not declared in app code. Covered by journeys lifecycleEnforcement (20270343) and requestDeadlines (20270344: request deadlines + reschedule), not by this matrix', 'supabase (server)']);
  flags.push(['info', 'server enforcement of the time/lock rules behind these actions (join / invite only before the start, accept only before the request deadline, a booked gathering keeps its time, fixed settings only via their function): migration 20270343, journey lifecycleEnforcement; audit PRODUCT_AUDIT/LIFECYCLE_ACTION_ENFORCEMENT_AUDIT_2026-10-24.md', 'supabase (server)']);

  return { kinds, expiry: expiry(), push, anim, flags };
}

// ---- markdown ----------------------------------------------------------------------------------------------------------------
const pushName = (t) => (RETIRED_PUSH[t] ? `${t} (retired: never sent)` : t);
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const TITLES = {
  gathering: 'Gathering (viewer side)', request: 'Business request (customer)', offer: 'Business reply / offer (customer)',
  opportunity: 'Opportunity (business side of an offer row)', invite: 'Social invite', group_plan: 'Group plan',
  group_participant: 'Group plan participant', business: 'Business (declared booking mode, item 72)',
};
const ROW_KIND_OF = { opportunity: 'offer' };

export function renderMarkdown(m) {
  const out = [];
  out.push('# Nearby lifecycle matrix (generated)');
  out.push('');
  out.push('Owner idea "391" (2026-10-24). GENERATED by `npm run lifecycle-matrix` from `src/qa/lifecycleMatrix.js`; do not edit by hand.');
  out.push('`src/qa/lifecycleMatrix.test.js` fails when this file and the code disagree. Every cell comes from the named source: read from a table,');
  out.push('or the real function called with a sample object in that state (fixed clock 2026-06-15 12:00 UTC). The code stays the source of truth;');
  out.push('this is a developer and phone-session reference, never app logic. What the code cannot establish is under Flags, never filled in.');
  out.push('');
  out.push('Columns: State · Class (lifecycleClass) · Visible (status word / card / Next line) · Primary CTA · Secondary · Allowed actions (LIFECYCLE = the');
  out.push('allowed transitions; the state each leads to is enforced server-side) · Animation (MOTION_TRIGGERS naming that stored state).');
  out.push('');
  const motionFor = (kind, state) => m.anim.bound.filter((b) => b.kind === kind && b.state === state).map((b) => b.name).join(', ');
  for (const [kind, rows] of Object.entries(m.kinds)) {
    out.push(`## ${TITLES[kind]}`);
    out.push('');
    const lk = ROW_KIND_OF[kind] ?? kind;
    if (kind === 'opportunity') {
      out.push('The business\'s view of the same offer row: Allowed actions and Animation are that row\'s (shared with the customer side); the business acts through the Primary CTA only.');
      out.push('');
    }
    const hasLifecycle = Boolean(LIFECYCLE[lk]);
    out.push('| State | Variant | Class | Visible | Primary CTA | Secondary | Allowed actions | Animation | Source |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const st = r.state;
      const allowed = hasLifecycle && LIFECYCLE[lk][st] ? LIFECYCLE[lk][st].join(', ') : '';
      const cls = hasLifecycle && LIFECYCLE[lk][st] ? lifecycleClass(lk, st) : '';
      const visible = r.visible ?? (hasLifecycle && LIFECYCLE[lk][st] && kind !== 'opportunity' ? `label: ${viewLabel(lk, st)}` : '');
      const primary = kind === 'request' || kind.startsWith('group_') ? '(screen: see Flags)' : fmt(r.cta) + (r.row !== undefined ? ` · list row: ${r.row ? `"${r.row.label}"` : 'none'}` : '');
      out.push(`| ${cell(st)}${r.probedState && r.probedState !== st ? ` (${cell(r.probedState)})` : ''} | ${cell(r.variant)} | ${cls} | ${cell(visible)} | ${cell(primary)} | ${cell(secondary(r.cta))} | ${cell(allowed)} | ${cell(motionFor(lk, st))} | ${cell(r.source)} |`);
    }
    out.push('');
    if (m.expiry[kind]) {
      out.push(`**Expiration:** ${m.expiry[kind].join(' ')}`);
      out.push('');
    }
    if (kind === 'offer') {
      out.push('**Notifications:** an offer\'s pushes open its request screen on that offer (`focusOfferId`): listed under Business request.');
      out.push('');
    }
    const pushes = m.push.filter((p) => p.screens.some((s) => SCREEN_KIND[s] === kind));
    if (pushes.length) {
      out.push(`**Notifications opening this object** (${S.push}):`);
      out.push('');
      out.push('| Push type | Opens | Priority | Mute group |');
      out.push('|---|---|---|---|');
      for (const p of pushes) out.push(`| ${pushName(p.type)} | ${cell(p.screens.join(' / '))} | ${p.priority} | ${p.group} |`);
      out.push('');
    }
    const events = Object.entries(EVENT_STATE).filter(([, [k]]) => k === kind);
    if (events.length) {
      out.push(`**Domain events** (constants/domainEvents.js; state via the EVENT_STATE crosswalk): ${events.map(([e, [, s]]) => `${e} -> ${s}${RECORD_ONLY_EVENTS.includes(e) ? ' (record only, never notified)' : ''}`).join('; ')}`);
      out.push('');
    }
  }
  out.push('## Notifications not tied to a lifecycle object');
  out.push('');
  out.push('| Push type | Opens | Priority | Mute group |');
  out.push('|---|---|---|---|');
  for (const p of m.push.filter((x) => !x.screens.some((s) => SCREEN_KIND[s]))) out.push(`| ${pushName(p.type)} | ${cell(p.screens.join(' / ') || '(nothing)')} | ${p.priority} | ${p.group} |`);
  out.push('');
  out.push('## Animations not bound to a stored object state');
  out.push('');
  out.push(m.anim.unbound.map((u) => `${u.name} (${u.trigger})`).join(', '));
  out.push('');
  out.push('## Flags (what the code does not establish, or where tables disagree)');
  out.push('');
  out.push('Kinds: conflict = two sources disagree; missing = no single code source; ambiguous = two readings possible; info = worth knowing, not wrong.');
  out.push('Reported only, never fixed here (owner: no behaviour change without approval).');
  out.push('');
  const order = { conflict: 0, missing: 1, ambiguous: 2, info: 3 };
  for (const [k, text, src] of [...m.flags].sort((a, b) => order[a[0]] - order[b[0]] || a[1].localeCompare(b[1]))) out.push(`- **${k}**: ${text} (${src})`);
  out.push('');
  return out.join('\n');
}

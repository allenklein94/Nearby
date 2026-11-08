// Admin review cases on the business website (20270368 + 20270369). Pure rules for AdminReviewScreen: wording of a case
// and its history, the photos grouped by account for side-by-side comparison, and which actions a case offers. The server
// decides everything that matters (admin-only functions, the Storage policy behind every photo link); these only present it.
// A case is a reason for a human to look, never proof: no wording here may call an account fake or a match certain.

export const ADMIN_PHOTO_LINK_SECONDS = 900; // 15-minute signed links; Storage re-checks the admin for each one
export const REOPEN_REASON_MIN = 10; // = admin_reopen_account_review_case
export const TEXT_MAX = 1000;

export const CASE_SIGNAL_LABEL = {
  identical_photo: 'Same photo file',
  similar_photo: 'Similar photo',
  behavior: 'Activity pattern',
  report: 'From a report',
  prior_suspension: 'Phone number of a suspended account',
  shared_device: 'Same phone notification token',
  shared_text: 'Same public text',
};

export const CASE_REASON_LABEL = {
  many_accounts: 'On several accounts',
  similar_names: 'On accounts with similar names',
  behavior_pattern: 'Unusual activity pattern',
  reported_profile: 'Opened by an admin from a report',
  suspended_number_reused: 'Signed up with a number a suspended account used',
  suspended_device: 'Also used by a suspended account',
};

export const OUTCOME_LABEL = { no_action: 'No action needed', action_taken: 'Action taken' };
export const CHECK_RESULT_LABEL = { match_found: 'Match found', no_match: 'No match', inconclusive: 'Inconclusive' };

export function caseTitle(c) {
  if (!c) return '';
  const signal = CASE_SIGNAL_LABEL[c.signal] || c.signal;
  const reason = CASE_REASON_LABEL[c.reason] || c.reason;
  return `${signal} · ${reason}`;
}

// Badges a case carries in the queue, most urgent first.
export function caseBadges(c) {
  if (!c) return [];
  const out = [];
  if (c.status === 'open' && c.overdue) out.push('Review overdue');
  if (c.status === 'closed' && c.new_evidence_since_closed) out.push('New evidence since closed');
  if (c.status === 'closed') out.push(`Closed · ${OUTCOME_LABEL[c.outcome] || c.outcome}`);
  return out;
}

// What the admin can do with this case now (the server re-checks every one).
export function caseActions(c) {
  if (!c) return [];
  return c.status === 'open' ? ['note', 'external_check', 'close'] : ['note', 'external_check', 'reopen'];
}

const who = (name, id) => name || (id ? `Account ${String(id).slice(0, 8)}` : 'Deleted account');

// One line per history event, oldest first, saying who did what (never a hash or fingerprint).
export function eventLine(e) {
  const d = e?.detail || {};
  const actor = e?.actor ? who(e.actor_name, e.actor) : 'Nearby';
  const subject = who(e?.subject_name, e?.subject);
  switch (e?.kind) {
    case 'opened': return `Opened by ${actor}${d.backfilled ? ' (recorded later)' : ''}`;
    case 'member_added': return `${subject} added`;
    case 'new_evidence': return d.signals ? `New activity since closed (${d.signals.length} signal${d.signals.length === 1 ? '' : 's'})` : `New evidence since closed: ${subject}`;
    case 'note': return `${actor}: ${d.note}`;
    case 'external_check': return `${actor} checked ${d.source}: ${CHECK_RESULT_LABEL[d.result] || d.result}${d.link ? ` (${d.link})` : ''}${d.note ? ` · ${d.note}` : ''}`;
    case 'report_linked': return `Report linked by ${actor}${d.note ? `: ${d.note}` : ''}`;
    case 'closed': return `Closed by ${actor}: ${OUTCOME_LABEL[d.outcome] || d.outcome}${d.note ? ` · ${d.note}` : ''}`;
    case 'reopened': return `Reopened by ${actor}: ${d.reason}`;
    default: return e?.kind || '';
  }
}

// The case's photos grouped by account (members order), each account's photos in the order they were added, so the
// reviewer sees the accounts side by side. Accounts with no photo still in storage show with an empty list.
export function photosByAccount(c) {
  if (!c) return [];
  const members = Array.isArray(c.members) ? c.members : [];
  const photos = Array.isArray(c.photos) ? c.photos : [];
  const groups = members.map((m) => ({
    userId: m.user_id,
    name: who(m.display_name, m.user_id),
    suspended: !!m.suspended,
    afterClose: !!m.after_close,
    photos: photos.filter((p) => p.user_id === m.user_id).map((p) => ({ objectId: p.object_id, path: p.path, inUse: !!p.in_use })),
  }));
  for (const p of photos) {
    if (!members.some((m) => m.user_id === p.user_id)) {
      let g = groups.find((x) => x.userId === p.user_id);
      if (!g) { g = { userId: p.user_id, name: who(null, p.user_id), suspended: false, afterClose: false, photos: [] }; groups.push(g); }
      g.photos.push({ objectId: p.object_id, path: p.path, inUse: !!p.in_use });
    }
  }
  return groups;
}

export function casePhotoPaths(c) {
  return [...new Set((Array.isArray(c?.photos) ? c.photos : []).map((p) => p.path).filter(Boolean))];
}

// Signed links come back from Storage per path; a path Storage refused (no admin, photo no longer in a case) has none.
export function signedUrlMap(results) {
  const out = {};
  for (const r of Array.isArray(results) ? results : []) {
    if (r && r.path && r.signedUrl && !r.error) out[r.path] = r.signedUrl;
  }
  return out;
}

// Links are valid for 15 minutes; refresh a minute before.
export function linksStale(signedAt, now = Date.now()) {
  return !signedAt || now - signedAt > (ADMIN_PHOTO_LINK_SECONDS - 60) * 1000;
}

export function reopenReasonProblem(reason) {
  const r = (reason || '').trim();
  if (r.length < REOPEN_REASON_MIN) return `Say what is new (at least ${REOPEN_REASON_MIN} characters).`;
  if (r.length > TEXT_MAX) return `Keep it under ${TEXT_MAX} characters.`;
  return null;
}

export function linkProblem(link) {
  const l = (link || '').trim();
  if (!l) return null;
  return /^https:\/\/\S+$/.test(l) ? null : 'Use an https link.';
}

// Reports an admin may turn into an investigation (any report about an account; the report itself never opens one).
export function canOpenInvestigation(report) {
  return !!report && !!report.reported_id;
}

// A prior-suspension case (20270374): the earlier account's decisions, from admin_get_prior_suspension. A matching number is
// a reason to look, never proof it is the same person: numbers are reassigned. Never shows the number (the server never
// returns it). One line per decision, oldest first, plus a line when the record has expired (12 months).
export const PRIOR_SUSPENSION_NOTE = 'A matching phone number is a reason to look, not proof it is the same person: carriers reassign numbers. Nothing has happened to this account.';
const RELEASED_LABEL = { account_deleted: 'Earlier account deleted', number_changed: 'Earlier account moved to another number' };
const DECISION_LABEL = { suspend: 'Suspended', reinstate: 'Reinstated' };

export function priorSuspensionLines(records) {
  const out = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || !r.still_kept) { out.push('Earlier record no longer kept (12-month limit)'); continue; }
    out.push(`${RELEASED_LABEL[r.released] || 'Earlier account'} ${new Date(r.released_at).toLocaleDateString()} · record kept until ${new Date(r.expires_at).toLocaleDateString()}`);
    for (const d of Array.isArray(r.decisions) ? r.decisions : []) {
      const by = d.admin_name || (d.admin_id ? `Admin ${String(d.admin_id).slice(0, 8)}` : 'an admin');
      out.push(`${new Date(d.at).toLocaleString()} · ${DECISION_LABEL[d.action] || d.action} by ${by}${d.reason ? `: ${d.reason}` : ''}`);
    }
  }
  return out;
}

// Shared-device cases (20270376): the same app install's notification token registered by several accounts. Only counts and
// the suspended accounts' ids/times reach the admin; never the token or its key.
export const SHARED_DEVICE_NOTE = 'The same notification token is a reason to look, not proof it is the same person: families share phones, one person may have several accounts, and a token can move with a phone. Nothing has happened to these accounts.';

export function sharedDeviceLines(evidence) {
  const e = evidence && typeof evidence === 'object' ? evidence : {};
  const out = [];
  if (Number.isFinite(e.accounts)) out.push(`${e.accounts} account${e.accounts === 1 ? '' : 's'} registered this token in the last ${e.window_days || 90} days`);
  const live = Array.isArray(e.suspended_accounts) ? e.suspended_accounts : [];
  if (live.length) out.push(`${live.length} of them suspended`);
  const also = Array.isArray(e.corroborating_cases) ? e.corroborating_cases : [];
  if (also.length) {
    const kinds = [...new Set(also.map((c) => CASE_SIGNAL_LABEL[c.signal] || c.signal))];
    out.push(`Opened because these accounts are also in ${also.length} other review case${also.length === 1 ? '' : 's'}: ${kinds.join(', ')}`);
  }
  for (const f of Array.isArray(e.former_suspended_accounts) ? e.former_suspended_accounts : []) {
    out.push(`Earlier on a suspended account since deleted (Account ${String(f.former_account_id).slice(0, 8)}, suspended ${new Date(f.suspended_at).toLocaleDateString()})`);
  }
  return out;
}

// Shared-text cases (20270378): the same long public bio or public gathering description posted by several accounts. Only
// counts and the public gatherings' ids reach the admin; never the text or its key (the admin reads the text where it is
// already public: the accounts' profiles and those gatherings).
export const SHARED_TEXT_NOTE = 'The same public text is a reason to look, not proof it is the same person: co-organisers, clubs and friends copy each other\'s descriptions. If it is legitimate, close the case as "No action needed". Nothing has happened to these accounts.';

export function sharedTextLines(evidence) {
  const e = evidence && typeof evidence === 'object' ? evidence : {};
  const out = [];
  const days = e.window_days || 30;
  if (Number.isFinite(e.accounts)) out.push(`${e.accounts} account${e.accounts === 1 ? '' : 's'} in this case`);
  if (Number.isFinite(e.texts) && e.texts > 1) out.push(`${e.texts} different texts shared by the same accounts`);
  if (Number.isFinite(e.bio_accounts) && e.bio_accounts > 0) out.push(`${e.bio_accounts} posted the same profile bio in the last ${days} days`);
  if (Number.isFinite(e.gathering_accounts) && e.gathering_accounts > 0) out.push(`${e.gathering_accounts} posted the same public gathering description in the last ${days} days`);
  const ids = Array.isArray(e.gathering_ids) ? e.gathering_ids : [];
  if (ids.length) out.push(`Gatherings: ${ids.map((id) => String(id).slice(0, 8)).join(', ')}`);
  return out;
}

// Shared review cases (20270379): for each account in the open case, the OTHER existing review cases it is in and the
// other accounts in those cases, from admin_get_shared_review_cases. Direct connections only: the accounts listed under a
// linked case are never expanded further (the admin opens that case to look). The relationship is always "Shared review
// case", never "same person" or "likely related"; each line names the case's own signal, reason and status.
export const SHARED_CASE_LABEL = 'Shared review case';
export const SHARED_CASES_NOTE = 'Other review cases these accounts are in. Being in the same review case is not proof the accounts belong to the same person or are related; open a case to see why it exists. Nothing here changes any account.';

const CASE_STATUS_LABEL = { open: 'Open' };

export function caseStatusLine(c) {
  if (!c) return '';
  const parts = [c.status === 'closed' ? `Closed · ${OUTCOME_LABEL[c.outcome] || c.outcome}` : (CASE_STATUS_LABEL[c.status] || c.status)];
  if (c.status === 'open' && c.overdue) parts.push('Review overdue');
  if (c.status === 'closed' && c.new_evidence_since_closed) parts.push('New evidence since closed');
  return parts.join(' · ');
}

// One group per account of the open case that is in at least one other case; each linked case once, with the other
// accounts by name (an account also in the open case is marked so). Accounts with no other case are left out.
export function sharedCaseGroups(result) {
  const out = [];
  for (const a of Array.isArray(result) ? result : []) {
    const seen = new Set();
    const cases = [];
    for (const c of Array.isArray(a?.cases) ? a.cases : []) {
      if (!c || !c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      const others = [];
      const seenOther = new Set();
      for (const o of Array.isArray(c.other_accounts) ? c.other_accounts : []) {
        if (!o || seenOther.has(o.user_id) || o.user_id === a.user_id) continue;
        seenOther.add(o.user_id);
        others.push(`${who(o.display_name, o.user_id)}${o.in_this_case ? ' (also in this case)' : ''}${o.suspended ? ' · Suspended' : ''}`);
      }
      cases.push({
        id: c.id,
        label: SHARED_CASE_LABEL,
        title: caseTitle(c),
        status: caseStatusLine(c),
        opened: c.opened_at,
        others: others.length ? `With ${others.join(', ')}` : 'No other accounts in that case',
      });
    }
    if (!cases.length) continue;
    const total = Number.isFinite(a.total) ? a.total : cases.length;
    out.push({
      userId: a.user_id,
      name: who(a.display_name, a.user_id),
      suspended: !!a.suspended,
      cases,
      more: total > cases.length ? total - cases.length : 0,
    });
  }
  return out;
}

// Account facts (20270401): one account's facts for a review case. Plain facts only: never a score, a verdict or a
// recommendation. Reports are allegations until an admin records an outcome, so the two are never one number.
// Unknown stays out (no invented 0 and no guessed age).
const DAY_MS = 86400000;
export function accountAgeLabel(createdAt, now = Date.now()) {
  const at = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(at) || at > now) return null;
  const days = Math.floor((now - at) / DAY_MS);
  if (days < 1) return 'Less than 1 day';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `${Math.floor(days / 30)} months`;
  return `${Math.floor(days / 365)} years`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function accountFactsLines(f, now = Date.now()) {
  const age = accountAgeLabel(f?.account_created_at, now);
  const account = [
    age ? `Account age: ${age}` : null,
    typeof f?.phone_verified === 'boolean' ? (f.phone_verified ? 'Phone verified' : 'Phone not verified') : null,
    f?.level === 'established' ? 'Established' : f?.level === 'new' ? 'New' : null,
  ].filter(Boolean).join(' · ');
  const received = Number(f?.reports_received) || 0;
  const breakdown = [
    f?.reports_open ? `${f.reports_open} open` : null,
    f?.reports_no_action ? `${f.reports_no_action} closed, no action` : null,
    f?.reports_action_taken ? `${f.reports_action_taken} closed, action taken` : null,
    f?.reports_no_outcome ? `${f.reports_no_outcome} closed, no outcome recorded` : null,
  ].filter(Boolean).join(' · ');
  return {
    name: f?.display_name || f?.user_id || '',
    account,
    reports: received ? `${plural(received, 'report')} received: ${breakdown}` : 'No reports received',
  };
}

export const ACCOUNT_FACTS_NOTE = 'A report is an allegation until an admin records an outcome. Reports about a business aren\'t included, and resolved reports are deleted after 12 months.';

// Link count in the case (20270404). Only what the server counted; no text checked = no line, never a 0 that was never looked for.
export function caseLinkCountLine(c) {
  const checked = Number(c?.texts_checked);
  if (!Number.isInteger(checked) || checked < 1) return null;
  const links = Number(c?.distinct_links) || 0;
  const texts = plural(checked, 'reported text');
  if (!links) return `Possible external links: 0 · ${texts} checked`;
  return `Possible external links: ${links} · found in ${Number(c?.texts_with_links) || 0} of ${texts} checked`;
}

export const CASE_LINK_COUNT_NOTE = 'Each different link counts once. Only the reported text stored with this case is checked, and a stored copy can be cut short; the reporter\'s words and anything not reported aren\'t checked. Detection can also match ordinary words like "node.js", so read the text. A link isn\'t a finding.';

// The function isn't on this database yet (older database): show nothing rather than an error.
export function accountFactsMissing(error) {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

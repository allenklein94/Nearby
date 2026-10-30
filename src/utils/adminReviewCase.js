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
};

export const CASE_REASON_LABEL = {
  many_accounts: 'On several accounts',
  similar_names: 'On accounts with similar names',
  behavior_pattern: 'Unusual activity pattern',
  reported_profile: 'Opened by an admin from a report',
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

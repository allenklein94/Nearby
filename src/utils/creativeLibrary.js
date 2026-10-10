// "Your photos & videos" (owner, 2026-10-10, LOCKED). A business adds media it already has (photos, videos, graphics,
// offer images) to its creative library; every item is screened like offer media before it can be used. Pure: stored
// state in, wording and eligibility out. Stored states (business_creatives.status):
//   reviewing      being checked (by the classifier, or held for the team)            -> "Reviewing…"
//   ready          passed screening, can be attached to an offer                       -> "Ready to use"
//   needs_changes  did not pass (policy categories) or the file could not be used     -> "Needs changes" + the reason
//   retry          the check could not finish (service failure); nothing was approved  -> "We couldn't finish checking this"
// Only a ready, non-archived item ever reaches the offer form's picker; the database refuses anything else on an offer.
import { tr } from '../i18n/translate';
import { joinAnd } from '../i18n/list';
import { CATEGORY_PHRASES } from './offerSubmission';

const L = (key, vars) => tr(`ui.bizHelp.library.${key}`, vars);

// A review that has been "reviewing" this long with no screening record never got an answer (the worker stopped): it is
// offered a retry. The server applies the same 3 minutes before it accepts one.
export const CREATIVE_STALE_MS = 3 * 60 * 1000;

export function isStalled(item, now = Date.now()) {
  if (item?.status !== 'reviewing' || item?.screening_id) return false;
  const since = item?.reviewing_since ? new Date(item.reviewing_since).getTime() : NaN;
  return Number.isFinite(since) && now - since > CREATIVE_STALE_MS;
}

// Items the owner can attach to an offer: ready and not removed. Nothing else, whatever the list holds.
export function pickerCreatives(items) {
  return (Array.isArray(items) ? items : []).filter((c) => c && c.status === 'ready' && !c.archived_at);
}

export function canRetry(item, now = Date.now()) {
  return item?.status === 'retry' || isStalled(item, now);
}

// The reason shown under "Needs changes": the server's own plain message, else the fixed policy categories (never the
// classifier's free text), else a generic line.
export function needsChangesReason(item) {
  if (item?.problem) return item.problem;
  const phrases = (item?.matched_categories ?? []).filter((c) => CATEGORY_PHRASES[c]).map((c) => tr(`ui.bizHelp.submission.category.${c}`));
  if (phrases.length > 0) return L('involves', { list: joinAnd(phrases) });
  return L('didntPass');
}

// -> { state, title, detail, tone: 'progress'|'success'|'warning'|'danger', actions: ('retry'|'remove')[] }
export function creativeView(item, now = Date.now()) {
  if (canRetry(item, now)) {
    return { state: 'retry', title: L('retryTitle'), detail: L('retryBody'), tone: 'warning', actions: ['retry', 'remove'] };
  }
  switch (item?.status) {
    case 'ready':
      return { state: 'ready', title: L('readyTitle'), detail: null, tone: 'success', actions: ['remove'] };
    case 'needs_changes':
      return { state: 'needs_changes', title: L('needsChangesTitle'), detail: needsChangesReason(item), tone: 'danger', actions: ['remove'] };
    default:
      return { state: 'reviewing', title: L('reviewingTitle'), detail: L('reviewingBody'), tone: 'progress', actions: [] };
  }
}

// True while something is still being checked, so the screen keeps looking until each answer arrives.
export function anyReviewing(items) {
  return (Array.isArray(items) ? items : []).some((c) => c?.status === 'reviewing' && !c.archived_at);
}

// ---- Logo upload ----
// A new logo must be a file Nearby stores for THIS business (public bucket business-logos), never a typed address. The
// server enforces the same rule; this only lets the screen tell the owner before sending.
export function isStoredLogoUrl(url, partnerId, supabaseUrl) {
  if (typeof url !== 'string' || !partnerId || !supabaseUrl) return false;
  return url.startsWith(`${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/business-logos/${partnerId}/`);
}

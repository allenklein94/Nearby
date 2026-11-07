// Admin-controlled temporary restrictions (20270399). ONE place for what can be paused, how long, whether a reason is long enough,
// how a restriction reads to an admin, and what the person is told when a paused action is refused. The server decides
// everything again (admin_restrict_account / admin_lift_account_restriction / admin_list_account_restrictions: admins only,
// written reason, 1-30 days, append-only record); nothing here can restrict anyone. Nothing is ever automatic.
import { tr } from '../i18n/translate';

export const RESTRICTION_REASON_MIN = 10; // = the server's check
export const RESTRICTION_REASON_MAX = 1000;
export const RESTRICTION_DAYS = [1, 3, 7, 14, 30]; // the server accepts 1-30
export const RESTRICTION_DEFAULT_DAYS = 3;

// Admin screens are English (like the rest of Admin Reports). Order = how they show.
export const RESTRICTION_CAPABILITIES = [
  { key: 'messages', label: 'Messages', covers: 'new messages in every chat, photo comments, gathering questions' },
  { key: 'invitations', label: 'Invitations', covers: 'inviting people to gatherings, communities and plans' },
  { key: 'friend_requests', label: 'Friend requests', covers: 'friend requests, Connect in friend discovery, waves and notices' },
  { key: 'gatherings', label: 'Creating gatherings', covers: 'creating a gathering or a community (editing stays possible)' },
  { key: 'offers', label: 'Business offers', covers: "as a business: sending or changing replies, availability, perks, updates (automatic replies keep working)" },
  { key: 'links', label: 'Links', covers: 'adding a new link to their profile, gatherings, communities or messages' },
];
const LABEL = Object.fromEntries(RESTRICTION_CAPABILITIES.map((c) => [c.key, c.label]));

export function restrictionLabel(capability) {
  return LABEL[capability] || capability;
}

export function restrictionReasonReady(reason) {
  const length = String(reason || '').trim().length;
  return length >= RESTRICTION_REASON_MIN && length <= RESTRICTION_REASON_MAX;
}

// The form can be sent only with at least one known action, an allowed duration and a reason.
export function restrictionFormReady(form) {
  if (!form) return false;
  const caps = (form.capabilities || []).filter((c) => LABEL[c]);
  return caps.length > 0 && RESTRICTION_DAYS.includes(form.days) && restrictionReasonReady(form.reason);
}

export function toggleCapability(list, key) {
  const set = new Set(list || []);
  if (set.has(key)) set.delete(key); else if (LABEL[key]) set.add(key);
  return RESTRICTION_CAPABILITIES.map((c) => c.key).filter((k) => set.has(k));
}

// Active ones only (the server marks them; an expired or lifted one never counts as active here either).
export function activeRestrictions(rows, now = Date.now()) {
  return (rows || []).filter((r) => r && r.active && !r.lifted_at && Date.parse(r.expires_at) > now);
}

export function restrictionStatusLine(r) {
  if (!r) return null;
  const until = new Date(r.expires_at).toLocaleString();
  if (r.lifted_at) return `${restrictionLabel(r.capability)} · lifted ${new Date(r.lifted_at).toLocaleString()}: ${r.lift_reason}`;
  if (!r.active) return `${restrictionLabel(r.capability)} · ended ${until}`;
  return `${restrictionLabel(r.capability)} paused until ${until}${r.admin_name ? ` · by ${r.admin_name}` : ''}: ${r.reason}`;
}

// What the person sees when the server refuses a paused action: hint 'account_restricted', details = {"capability","until"}.
// null = not a restriction refusal. An unreadable date still says the action is paused, never invents one.
export function restrictionRefusal(error) {
  if (!error || error.hint !== 'account_restricted') return null;
  let detail = null;
  try { detail = JSON.parse(error.details ?? error.detail ?? ''); } catch (e) { detail = null; }
  const until = detail && Date.parse(detail.until) ? new Date(detail.until) : null;
  return { capability: detail?.capability || null, until };
}

export function restrictionRefusalMessage(refusal, formatDate = defaultFormatDate) {
  if (!refusal) return null;
  // the server always sends the end; if it can't be read, keep only the first sentence (never a made-up date)
  if (!refusal.until) return tr('ui.shared.errors.accountRestricted', { date: '' }).split(/(?<=[.。])\s*/u)[0];
  return tr('ui.shared.errors.accountRestricted', { date: formatDate(refusal.until) });
}

function defaultFormatDate(date) {
  try {
    return date.toLocaleString(undefined, { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return date.toLocaleString();
  }
}

// Business website links (owner, 2026-11-14): a business alert email links to the exact request, like the push does.
//
// The email (send-push, web-only owners) adds `?n=<notification type>&r=<request id>` to BUSINESS_WEB_URL. The website
// keeps that pair across sign-in (sessionStorage, this tab only), then opens the SAME destination a push tap opens
// (navigation/notificationDestinations.js, the one table), limited to the screens the website has. The link carries no
// personal data: the dashboard re-reads the request's current state under the owner's own access (an old or someone
// else's request id shows the existing "no longer available" state, never data).
import { notificationDestination } from '../navigation/notificationDestinations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE = /^[a-z_]{1,64}$/;
const KEY = 'nearby.businessWebLink';

// Routes the business website really registers (navigation/BusinessWebNavigator.js; guard in the test).
export const BUSINESS_WEB_ROUTES = Object.freeze([
  'BusinessDashboard', 'BusinessProfile', 'BusinessConversation', 'GatheringDetail', 'CommunityDetail',
]);
const FALLBACK = { name: 'BusinessDashboard', params: { initialSection: 'requests' } };

// `?n=...&r=...` -> { type, requestId } or null. Anything malformed = null (the plain dashboard).
export function parseBusinessWebLink(search) {
  let q;
  try { q = new URLSearchParams(String(search || '')); } catch (_e) { return null; }
  const type = q.get('n');
  const requestId = q.get('r');
  if (!type || !TYPE.test(type) || !requestId || !UUID.test(requestId)) return null;
  return { type, requestId: requestId.toLowerCase() };
}

// Mirror of the link send-push builds (supabase/functions/send-push/index.ts, guard keeps them equal).
export function businessWebLinkUrl(baseUrl, type, requestId) {
  if (!baseUrl) return null;
  if (!type || !TYPE.test(type) || !requestId || !UUID.test(requestId)) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}n=${encodeURIComponent(type)}&r=${requestId}`;
}

// At website start: keep the link for after sign-in and take it out of the address bar. Never throws.
export function captureBusinessWebLink(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return null;
  const link = parseBusinessWebLink(win.location?.search);
  if (!link) return null;
  try { win.sessionStorage?.setItem(KEY, JSON.stringify(link)); } catch (_e) { /* private mode: the link is lost, the dashboard still opens */ }
  try {
    const q = new URLSearchParams(win.location.search);
    q.delete('n'); q.delete('r');
    const rest = q.toString();
    win.history?.replaceState?.(null, '', `${win.location.pathname}${rest ? `?${rest}` : ''}${win.location.hash || ''}`);
  } catch (_e) { /* address bar keeps it; harmless */ }
  return link;
}

// Read once, after sign-in (removed so a later visit never reopens it).
export function takeBusinessWebLink(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return null;
  try {
    const raw = win.sessionStorage?.getItem(KEY);
    win.sessionStorage?.removeItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && TYPE.test(v.type) && UUID.test(v.requestId) ? v : null;
  } catch (_e) {
    return null;
  }
}

// Where the website opens for a link: the push's own destination when the website has that screen, else Opportunities.
export async function businessWebDestination(link) {
  if (!link) return { name: 'BusinessDashboard' };
  let dest = null;
  // `r` = the alert's one object id: a request, or for a customer-message alert (20270428) that message.
  try { dest = await notificationDestination({ type: link.type, request_id: link.requestId, message_id: link.requestId }); } catch (_e) { dest = null; }
  return dest && BUSINESS_WEB_ROUTES.includes(dest.name) ? dest : FALLBACK;
}

// Idea "395" (owner, 2026-10-24): what an EXPIRED business request offers its requester, from ONE rule.
//   'reopen'             the request's own time is still ahead: the existing Reopen Request (reopen_business_request)
//   'ask_again_tomorrow' a plain request whose day/time has passed: the existing request form, prefilled, Tomorrow selected
//                        by the person's tap; they review and Send, which runs normal matching again (a new request, a new
//                        "We asked N"); the original businesses are never contacted again by this
//   null                 nothing (a gathering's request whose gathering has started: rescheduling the gathering is the path;
//                        a match / community / plan / add-on request whose time passed: those keep their own flows)
// Mirrors reopen_business_request's deadline so the button is never one the server must refuse: no day = always reopenable
// (the server gives 48 h); a day = that day + (start, else end, else 23:59:59) local; a gathering = until it starts.
// The server stays the final authority: a refusal it still gives switches the screen to 'ask_again_tomorrow' (see the screen).
import { mentionsStatedDate } from '../constants/clockWindow';
import { canDo } from './objectLifecycle';

const DAY_WORDS_RE = /\b(tonight|tonite|this\s+evening|today|tomorrow|right\s+now|now|weekend)\b/;

const minutesOf = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 24 * 60 ? v : null;
};

const localDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

// The instant the request's own time ends (null = no day: no deadline of its own).
export function requestOwnDeadline(request) {
  const day = localDate(request?.date);
  if (!day) return null;
  const mins = minutesOf(request.time_window_start) ?? minutesOf(request.time_window_end);
  const end = new Date(day);
  if (mins == null) end.setHours(23, 59, 59, 0);
  else end.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return end;
}

const isPlainRequest = (r) => !r.gathering_id && !r.match_id && !r.community_id && !r.group_plan_id && !r.parent_request_id;

// gatheringStartsAt: the linked gathering's scheduled_at (only read for a gathering's request). serverRefusedReopen: the server
// already answered "time has passed" for this request (its clock/zone is the authority), so it is treated as passed.
export function expiredRequestAction(request, { viewerId, gatheringStartsAt = null, serverRefusedReopen = false, now = new Date() } = {}) {
  if (!request || request.requester_id !== viewerId || !canDo('request', request.status, 'reopen')) return null;
  if (request.gathering_id) {
    const starts = gatheringStartsAt ? new Date(gatheringStartsAt) : null;
    return !serverRefusedReopen && starts && !isNaN(starts) && starts > now ? 'reopen' : null;
  }
  const deadline = requestOwnDeadline(request);
  if (!serverRefusedReopen && (!deadline || deadline > now)) return 'reopen';
  return isPlainRequest(request) ? 'ask_again_tomorrow' : null;
}

// The existing form's prefill for "Ask again for tomorrow". Carries what the person stated; never the businesses, the
// one-business note (free text goes only to ONE business, and this asks nearby businesses again), or words naming a day
// (a "tonight" box beside a Tomorrow chip would contradict it: the form asks for the words again instead).
export function askAgainTomorrowParams(request, now = new Date()) {
  const text = String(request?.raw_text ?? '').trim();
  const namesDay = !!text && (DAY_WORDS_RE.test(text.toLowerCase()) || mentionsStatedDate(text));
  const mins = minutesOf(request?.time_window_start);
  // The stated clock time is kept only when that time tomorrow is still ahead (it always is today; checked, never assumed).
  const tomorrowAt = mins == null ? null : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, Math.floor(mins / 60), mins % 60);
  return {
    prefillText: text && !namesDay ? text : null,
    prefillCategory: request?.category ?? null,
    prefillPartySize: request?.party_size ?? null,
    prefillBudgetMax: request?.budget_max ?? null,
    prefillDateWindow: 'tomorrow',
    prefillStartMinutes: tomorrowAt && tomorrowAt > now ? mins : null,
    prefillRadiusMiles: request?.radius_miles ?? null,
    prefillOccasion: request?.occasion ?? null,
    prefillExperienceLevel: request?.experience_level ?? null,
    prefillCuisine: request?.cuisine ?? null,
    prefillDietary: Array.isArray(request?.dietary) && request.dietary.length ? request.dietary : null,
    prefillRequestedItems: Array.isArray(request?.requested_items) && request.requested_items.length ? request.requested_items : null,
  };
}

// The server's "time has passed" refusal (reopen_business_request), so the screen can offer asking again instead.
export const isReopenTimePassedError = (e) => /time for this request has passed/i.test(String(e?.message ?? e ?? ''));

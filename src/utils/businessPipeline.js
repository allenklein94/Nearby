import { canRespondToOpportunity, requestLifecycleState } from './objectLifecycle';
import { isOfferExpired } from './objectState';
import { localDayKey } from './dashboardGlance';

// Owner item 147: the business's requests read as one lightweight pipeline, New -> Reviewing -> Offered -> Won ->
// Completed. This file is the ONE definition of each stage; the Opportunities strip and the Home brief both read it,
// so no surface can count a stage with its own rule. Every count is the owner's own real rows.
//
//  New        current open requests the business can still answer (canRespondToOpportunity: offer row pending, request
//             open and before its own deadline), minus any it already replied to that Nearby is still checking. No date
//             window: an old request that is still open counts; a closed / declined / expired one never does.
//  Reviewing  replies the business sent that Nearby is still checking before the customer sees them
//             (business_offer_submissions reviewing / in_review). Nearby never records that a business OPENED a
//             request (item 39), so "being considered" means "your reply is being checked". Current state.
//  Offered    offers still awaiting the customer: status offered, not past its own valid_until, and the request still
//             open (a request the customer cancelled, let expire or booked elsewhere resolves the offer). No date window.
//  Won        booked and not yet redeemed: status accepted (a cancelled reservation turns the offer cancelled, a
//             redemption turns it completed), minus visits the owner marked as a no-show. Current state.
//  Completed  redeemed (status completed) with completed_at in the CURRENT local calendar month (the device's month,
//             like every date on the dashboard). The only stage with a time window. A redeemed booking leaves Won and
//             counts here in the month it was redeemed.
// A row is in at most one stage (they key on different statuses, and New excludes Reviewing).

export const PIPELINE_STAGES = ['new', 'reviewing', 'offered', 'won', 'completed'];

const REVIEWING_STATUSES = ['reviewing', 'in_review'];

export function reviewingRequestIds(submissions) {
  return new Set((submissions ?? []).filter((s) => REVIEWING_STATUSES.includes(s?.status)).map((s) => s.request_id));
}

export function isPipelineNew(o, reviewingIds = new Set(), now = new Date()) {
  return canRespondToOpportunity(o, now) && !reviewingIds.has(o?.request_id);
}

export function isPipelineOffered(o, now = new Date()) {
  return o?.status === 'offered' && !isOfferExpired(o, now) && requestLifecycleState(o?.business_requests, now) === 'open';
}

export function isPipelineWon(o, noShowIds = new Set()) {
  return o?.status === 'accepted' && !noShowIds.has(o?.id);
}

export function isCompletedThisMonth(o, now = new Date()) {
  if (o?.status !== 'completed' || !o?.completed_at) return false;
  const key = localDayKey(o.completed_at);
  const today = localDayKey(now);
  return key != null && today != null && key.slice(0, 7) === today.slice(0, 7);
}

// -> { new, reviewing, offered, won, completed } counts.
export function businessPipeline(opportunities, submissions, { now = new Date(), noShowIds = new Set() } = {}) {
  const list = opportunities ?? [];
  const reviewingIds = reviewingRequestIds(submissions);
  return {
    new: list.filter((o) => isPipelineNew(o, reviewingIds, now)).length,
    reviewing: (submissions ?? []).filter((s) => REVIEWING_STATUSES.includes(s?.status)).length,
    offered: list.filter((o) => isPipelineOffered(o, now)).length,
    won: list.filter((o) => isPipelineWon(o, noShowIds)).length,
    completed: list.filter((o) => isCompletedThisMonth(o, now)).length,
  };
}

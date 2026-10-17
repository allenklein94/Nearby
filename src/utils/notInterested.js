// "Not interested" on a recommended gathering card (owner idea "153", 2026-10-17, LOCKED). The ONE rule for which card offers
// it and which gatherings it hides; Home and Discover only lay it out.
//
//   Where: Home's Picked For You (not its Best Pick lead) and Nearby Right Now, and Discover's browse gathering tiles. Never on
//     typed-ask results, the person's own plans, Best Pick, or any other card type (perks, places, people, communities).
//   Which cards: an upcoming gathering whose viewer state is KNOWN and empty (`upcoming_none`: not hosting, joined, requested or
//     waitlisted) and that the person has not marked Interested. The server re-checks all of it (dismiss_recommended_gathering).
//   What it does: hides that gathering from the person's recommendations and ranks its kind lower (utils/experienceFeedback.js,
//     full weight). Never the host or the business. Private: no host, business, count, push, analytics or AI service sees it.
//   How it looks (item 200's narrow exception): a quiet ⋯ beside the card's one action opens ONE inline "Not interested" row;
//     the card's primary action is unchanged. Choosing it replaces the card in place, at once, with no motion, by one line
//     ("We'll show you less like this." when a kind is really down-ranked, else "You won't see this one again.") and Undo.
import { gatheringPrimaryAction } from './primaryAction';
import { isNeverLearnedCategory } from '../constants/neverLearned';

export const NOT_INTERESTED_SURFACES = Object.freeze(['home.pickedForYou', 'home.rightNow', 'discover.browse']);

// interestedIds: the person's Interested gathering ids (a Set). Unknown (null) = no menu: never offer it on a card that may be a plan.
export function canDismissRecommendation(g, { myUserId = null, interestedIds = null, now = Date.now() } = {}) {
  if (!g?.id || !myUserId || !(interestedIds instanceof Set)) return false;
  if (interestedIds.has(g.id)) return false;
  return gatheringPrimaryAction(g, myUserId, now).state === 'upcoming_none';
}

// Whether dismissing this gathering lowers a kind (the same test the server makes); decides the line's wording.
export function dismissLowersKind(g) {
  const tag = g?.interest_tag;
  return typeof tag === 'string' && tag.length > 0 && !isNeverLearnedCategory(tag);
}

// The line that replaces the dismissed card.
export function dismissedLineKey(kindDownRanked) {
  return kindDownRanked ? 'ui.notInterested.lessLikeThis' : 'ui.notInterested.hiddenOnly';
}

// Ids to leave out of recommendations: what the server says is dismissed, plus what was dismissed on this device this session,
// minus what was undone this session. A gathering whose line is showing (`showingLine`) stays in its list so the line keeps
// the card's place until the screen reloads.
export function hiddenRecommendationIds(feedback, session = null, showingLine = null) {
  const out = new Set(feedback?.dismissedGatheringIds ?? []);
  for (const id of session?.dismissed ?? []) out.add(id);
  for (const id of session?.undone ?? []) out.delete(id);
  for (const id of showingLine ?? []) out.delete(id);
  return out;
}

export function withoutHidden(list, hidden) {
  if (!hidden || hidden.size === 0 || !Array.isArray(list)) return list;
  return list.filter((g) => !hidden.has(g?.id));
}

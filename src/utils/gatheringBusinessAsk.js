// Item 111: "Find a business" from a gathering. The gathering already says what, when, how many and where, so the request
// carries those facts (the server reads category/date/time/party size/location from the gathering itself; this file only
// words them for the host) and the host is asked ONE thing: "Anything specific you'd like the business to provide?".
// That answer is structured, never free text to a broadcast (minimum-payload rule): the closed requested-items list for
// coffee/food gatherings (item 69), dietary needs for food, and a note only when the request goes to ONE business.
import { whenLabel } from './timeContext';
import { countLabel } from './plural';
import { gatheringBusinessPartySize } from './gatheringFullness';
import { REQUESTED_ITEM_CATEGORIES } from '../constants/businessAttributes';

// The request's own text. Never the host's title (it can carry a name); the business never sees raw_text anyway.
export function gatheringRequestText(category) {
  return category ? `A ${category} gathering looking for a place to go` : 'A gathering looking for a place to go';
}

// What the request will carry, in the order the owner listed it. A fact the gathering does not have is left out, never
// guessed. Location is the gathering's own spot (the server routes from its coordinates; no place name is stored).
export function gatheringAskFacts(gathering, now = new Date()) {
  if (!gathering) return [];
  const facts = [];
  if (gathering.interest_tag) facts.push({ key: 'category', icon: '🏷️', label: gathering.interest_tag });
  const when = gathering.scheduled_at ? whenLabel(gathering.scheduled_at, now) : null;
  if (when) facts.push({ key: 'when', icon: '🕐', label: when });
  const party = gatheringBusinessPartySize(gathering);
  if (party > 0) facts.push({ key: 'party', icon: '👥', label: countLabel(party, 'person', 'people') });
  facts.push({ key: 'where', icon: '📍', label: 'Near your gathering' });
  return facts;
}

// Which answers the one question offers. Empty = nothing to ask; the facts alone are enough to send.
export function gatheringAskInputs(category, { targeted = false } = {}) {
  const inputs = [];
  if (REQUESTED_ITEM_CATEGORIES.includes(category)) inputs.push('items');
  if (category === 'Foodie') inputs.push('dietary');
  if (targeted) inputs.push('note');
  return inputs;
}

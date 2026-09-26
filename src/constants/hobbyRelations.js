// Hobbies cross categories (owner request, 2026-09-21). A declared hobby lightly lifts RELATED tags that live in other groups
// (Photography -> Museums, Trails, Art Galleries), so a hobby is not trapped in one category. Rules:
//   - directional: the key is the hobby a person DECLARED; the values are tags it lifts (never the reverse, never chained);
//   - a related match is weaker than a declared one (RELATED_POINTS 2 vs EXPLICIT_POINTS 5, same as a broad group) and never
//     stacks with the broad-group lift (the larger of the two applies);
//   - ranking only: nothing is hidden or added to a list, and the reason says what it is ("Related to your interest in X");
//   - client-side only: no server, no business ever sees it. Every tag must be a real canonical tag (guarded by a test).
import { canonicalizeInterests } from './interestGraph';
import { relatedActivities } from './activityDictionary';

export const RELATED_POINTS = 2;

export const HOBBY_RELATIONS = {
  Photography: ['Museums', 'Art Galleries', 'Trails', 'Scenic Views', 'Parks', 'Art Classes', 'Workshops', 'Camera Shops'],
  Gaming: ['Arcade', 'Board Games', 'Trivia', 'Escape Rooms', 'Tech Meetup'],
  'Board Games': ['Gaming', 'D&D', 'Trivia'],
  'D&D': ['Board Games', 'Gaming', 'Trivia'],
  Cooking: ['Cooking Class', 'Farmers Markets', 'Foodie', 'Wine'],
  Reading: ['Libraries', 'Lectures', 'Study Group', 'Coffee'],
  Crafts: ['Art Classes', 'Pottery', 'Workshops', 'Markets'],
  Music: ['Live Music', 'Concerts', 'Music Lessons', 'Festivals'],
  Gardening: ['Gardens', 'Parks', 'Farmers Markets', 'Florist', 'Workshops'],
  Fishing: ['Boating', 'Kayaking', 'Outdoors', 'Camping'],
  Running: ['Trails', 'Parks', 'Walking', 'Fitness'],
  Fashion: ['Boutiques', 'Clothing', 'Thrift & Vintage', 'Markets', 'Pop-Ups'],
  Technology: ['Tech Meetup', 'Electronics', 'Technology Classes', 'Conferences', 'Workshops'],
  Cars: ['Street Events', 'Special Events', 'Festivals'],
  Collecting: ['Thrift & Vintage', 'Markets', 'Pop-Ups', 'History', 'Museums'],
};

// The declared hobby that makes `tag` a related match, or null. A tag the person declared themselves is never "related".
export function relatedHobbyFor(tag, declared = []) {
  if (!tag) return null;
  const mine = canonicalizeInterests(declared);
  if (mine.includes(tag)) return null;
  return mine.find((h) => (HOBBY_RELATIONS[h] ?? []).includes(tag))
    // A sibling activity (activityDictionary: Padel for a Pickleball player) is related the same weak, labeled way.
    ?? mine.find((h) => relatedActivities(h).includes(tag))
    ?? null;
}

export function relatedInterestReason(hobby) {
  return hobby ? `Related to your interest in ${hobby}` : null;
}

// Hobby -> the business ATTRIBUTES (layer 3, businessAttributes.js) that suit it: "a coffee shop to edit photos" is a coffee shop
// that is laptop_friendly / photography_friendly. Only ever a small ranking lift on a business the ask already returned (never a
// filter, never a way into results); the business declared the attribute itself. Keys are guarded against the real attribute list.
export const HOBBY_ATTRIBUTES = {
  Photography: ['photography_friendly', 'laptop_friendly', 'waterfront'],
  Gaming: ['board_game_friendly', 'group_friendly'],
  'Board Games': ['board_game_friendly', 'group_friendly'],
  'D&D': ['board_game_friendly', 'group_friendly'],
  Reading: ['book_lovers', 'quiet', 'laptop_friendly'],
  Crafts: ['craft_friendly'],
  Technology: ['laptop_friendly'],
  Running: ['fitness_focused'],
  Fishing: ['waterfront'],
};

// { hobby, attribute } for the first declared hobby whose linked attribute this business row declares, else null.
export function hobbyAttributeMatch(rowAttributes, declared = []) {
  const attrs = Array.isArray(rowAttributes) ? rowAttributes : [];
  if (attrs.length === 0) return null;
  for (const hobby of canonicalizeInterests(declared)) {
    const attribute = (HOBBY_ATTRIBUTES[hobby] ?? []).find((a) => attrs.includes(a));
    if (attribute) return { hobby, attribute };
  }
  return null;
}

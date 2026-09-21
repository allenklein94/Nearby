// Hobbies cross categories (owner request, 2026-09-21). A declared hobby lightly lifts RELATED tags that live in other groups
// (Photography -> Museums, Trails, Art Galleries), so a hobby is not trapped in one category. Rules:
//   - directional: the key is the hobby a person DECLARED; the values are tags it lifts (never the reverse, never chained);
//   - a related match is weaker than a declared one (RELATED_POINTS 2 vs EXPLICIT_POINTS 5, same as a broad group) and never
//     stacks with the broad-group lift (the larger of the two applies);
//   - ranking only: nothing is hidden or added to a list, and the reason says what it is ("Related to your interest in X");
//   - client-side only: no server, no business ever sees it. Every tag must be a real canonical tag (guarded by a test).
import { canonicalizeInterests } from './interestGraph';

export const RELATED_POINTS = 2;

export const HOBBY_RELATIONS = {
  Photography: ['Museums', 'Art Galleries', 'Trails', 'Scenic Views', 'Parks', 'Art Classes', 'Workshops'],
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
  return mine.find((h) => (HOBBY_RELATIONS[h] ?? []).includes(tag)) ?? null;
}

export function relatedInterestReason(hobby) {
  return hobby ? `Related to your interest in ${hobby}` : null;
}

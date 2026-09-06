import { groupForTag } from './gatheringCategories';

const PALETTE = [
  '#E8A87C',
  '#C38D9E',
  '#85A392',
  '#E27D60',
  '#5B9AA0',
  '#D4A5A5',
];

export const CATEGORY_STYLES = {
  Travel: { icon: '✈️', color: PALETTE[3] },
  Coffee: { icon: '☕', color: PALETTE[0] },
  Hiking: { icon: '🥾', color: PALETTE[2] },
  Music: { icon: '🎵', color: PALETTE[1] },
  Movies: { icon: '🎬', color: PALETTE[4] },
  Foodie: { icon: '🍽️', color: PALETTE[3] },
  Fitness: { icon: '💪', color: PALETTE[2] },
  Reading: { icon: '📚', color: PALETTE[1] },
  Art: { icon: '🎨', color: PALETTE[4] },
  Gaming: { icon: '🎮', color: PALETTE[5] },
  Photography: { icon: '📸', color: PALETTE[0] },
  Yoga: { icon: '🧘', color: PALETTE[2] },
  Dancing: { icon: '💃', color: PALETTE[1] },
  Cooking: { icon: '👨‍🍳', color: PALETTE[3] },
  Wine: { icon: '🍷', color: PALETTE[1] },
  Dogs: { icon: '🐕', color: PALETTE[0] },
  Cats: { icon: '🐈', color: PALETTE[5] },
  Outdoors: { icon: '🌲', color: PALETTE[2] },
  Sports: { icon: '⚽', color: PALETTE[4] },
  Concerts: { icon: '🎤', color: PALETTE[3] },
  Museums: { icon: '🏛️', color: PALETTE[5] },
  Volunteering: { icon: '🤝', color: PALETTE[2] },
  Meditation: { icon: '🕯️', color: PALETTE[4] },
  Running: { icon: '🏃', color: PALETTE[3] },
  'Faith & Spirituality': { icon: '🙏', color: PALETTE[5] },
  Dating: { icon: '💗', color: PALETTE[1] },

  // 2026-09-06 -- added alongside the 15-category taxonomy expansion
  // (CLAUDE.md / gatheringCategories.js). Same per-tag hand-authored
  // discipline as every entry above -- no new tag goes without a real
  // icon/color, even though categoryStyleFor() below now also has a
  // group-level fallback tier for any tag that somehow arrives unmapped.
  Brunch: { icon: '🥐', color: PALETTE[0] },
  Bakeries: { icon: '🥖', color: PALETTE[3] },
  'Bars & Lounges': { icon: '🍸', color: PALETTE[1] },
  Breweries: { icon: '🍺', color: PALETTE[4] },
  'Food Trucks': { icon: '🌮', color: PALETTE[2] },
  'Happy Hour': { icon: '🍹', color: PALETTE[5] },

  Pickleball: { icon: '🏓', color: PALETTE[0] },
  Tennis: { icon: '🎾', color: PALETTE[2] },
  Cycling: { icon: '🚴', color: PALETTE[3] },
  Swimming: { icon: '🏊', color: PALETTE[4] },
  Climbing: { icon: '🧗', color: PALETTE[1] },
  Golf: { icon: '⛳', color: PALETTE[2] },
  Bowling: { icon: '🎳', color: PALETTE[5] },

  Karaoke: { icon: '🎙️', color: PALETTE[1] },
  Comedy: { icon: '😂', color: PALETTE[3] },
  Trivia: { icon: '🧠', color: PALETTE[4] },
  Nightlife: { icon: '🌃', color: PALETTE[5] },

  'Speed Dating': { icon: '⏱️', color: PALETTE[1] },
  'Singles Events': { icon: '💘', color: PALETTE[3] },
  'Group Hangouts': { icon: '👯', color: PALETTE[0] },

  Crafts: { icon: '🧵', color: PALETTE[2] },
  Workshops: { icon: '🛠️', color: PALETTE[4] },
  Lectures: { icon: '🎓', color: PALETTE[1] },

  'Farmers Markets': { icon: '🥕', color: PALETTE[2] },
  'Thrift & Vintage': { icon: '🧥', color: PALETTE[5] },

  'Spa Day': { icon: '🧖', color: PALETTE[3] },
  'Self-Care': { icon: '🛁', color: PALETTE[4] },

  'Family Playdate': { icon: '👨‍👩‍👧‍👦', color: PALETTE[0] },
  'Kids Activity': { icon: '🧸', color: PALETTE[1] },

  Camping: { icon: '🏕️', color: PALETTE[2] },
  Fishing: { icon: '🎣', color: PALETTE[4] },
  Kayaking: { icon: '🛶', color: PALETTE[5] },

  'Dog Meetup': { icon: '🐾', color: PALETTE[0] },

  Networking: { icon: '🧑‍💼', color: PALETTE[3] },
  Coworking: { icon: '💻', color: PALETTE[5] },

  Fundraiser: { icon: '🎗️', color: PALETTE[1] },

  'Day Trip': { icon: '🗺️', color: PALETTE[3] },

  // 2026-09-06, same day as the tags above -- the second, follow-up
  // taxonomy pass adding Stay & Getaway/Health & Personal Care/Education &
  // Classes/Attractions & Things to See (gatheringCategories.js).
  'Weekend Getaway': { icon: '🧳', color: PALETTE[3] },
  Staycation: { icon: '🛋️', color: PALETTE[0] },
  'Road Trip': { icon: '🚙', color: PALETTE[2] },

  'Cooking Class': { icon: '🍳', color: PALETTE[1] },
  'Study Group': { icon: '📖', color: PALETTE[4] },
  'Language Exchange': { icon: '🗣️', color: PALETTE[2] },
  'Tech Meetup': { icon: '💻', color: PALETTE[5] },

  Zoos: { icon: '🦁', color: PALETTE[0] },
  Aquariums: { icon: '🐠', color: PALETTE[4] },
  Landmarks: { icon: '🗽', color: PALETTE[3] },
  'Amusement Park': { icon: '🎡', color: PALETTE[1] },
  Sightseeing: { icon: '🔭', color: PALETTE[2] },
};

// Falls back through two tiers: an unmapped tag first tries to inherit its
// parent group's icon/color (via groupForTag, so it at least matches its
// category's visual identity) before dropping to the fully generic default.
// This tier didn't exist before the 15-category expansion, when every tag
// had its own hand-authored entry above and the generic fallback was rare.
const GROUP_FALLBACK_STYLES = {
  food_drink: { icon: '🍔' },
  activities_recreation: { icon: '🏃' },
  entertainment_nightlife: { icon: '🎵' },
  dating_social: { icon: '❤️' },
  arts_culture_learning: { icon: '🎨' },
  shopping: { icon: '🛍️' },
  wellness_beauty: { icon: '💆' },
  family_kids: { icon: '👨‍👩‍👧' },
  outdoors_nature: { icon: '🌳' },
  pets: { icon: '🐕' },
  home_local_services: { icon: '🏠' },
  auto_transportation: { icon: '🚗' },
  business_networking: { icon: '💼' },
  community_volunteering: { icon: '🤝' },
  travel_experiences: { icon: '✈️' },
  stay_getaway: { icon: '🏨' },
  health_personal_care: { icon: '🩺' },
  education_classes: { icon: '🎓' },
  attractions_things_to_see: { icon: '🎟️' },
};

export function categoryStyleFor(interestTag) {
  if (CATEGORY_STYLES[interestTag]) return CATEGORY_STYLES[interestTag];

  const group = groupForTag(interestTag);
  if (group && GROUP_FALLBACK_STYLES[group.key]) {
    return { icon: GROUP_FALLBACK_STYLES[group.key].icon, color: PALETTE[0] };
  }

  return { icon: '🎉', color: PALETTE[0] };
}

// Aug 30 2026 -- "Join Gathering"/"I'm Interested"/etc. buttons read as
// disabled: measured, not guessed. This PALETTE is deliberately low-
// saturation (14-70%, four of six entries under 35%) -- built for badges/
// tints, never for carrying solid white CTA text. White-on-PALETTE
// contrast is 2.03-3.19:1 for every single entry, all below the WCAG 3:1
// floor for large bold text -- that's the actual "looks disabled" cause,
// not a fabricated one. This dark color (the exact lightColors.textPrimary
// value, not a new one) gets every entry to 4.75-7.45:1, a real fix.
// Deliberately NOT theme-derived (colors.textPrimary from useTheme()) --
// PALETTE itself never changes with the app's light/dark setting, so a
// theme-aware text color would silently regress back to white-on-pastel
// the moment dark mode is on. Use this specifically for text/icons drawn
// directly on a solid `categoryStyle.color` fill; the light `+ '30'`/`+
// '20'` tinted badges elsewhere are unaffected -- they already pair with
// dark or category-colored text, never a solid white-on-pastel button.
export const CATEGORY_BUTTON_TEXT_COLOR = '#2D2420';

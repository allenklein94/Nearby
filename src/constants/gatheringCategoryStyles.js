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
  // Added for the category/filter taxonomy pass (CLAUDE.md) -- the one
  // whole group with no prior coverage at all. Deliberately not added to
  // gatheringIndoorOutdoor.js (a date can honestly be either) or
  // gatheringCoverPhotos.js (no verified real image sourced this pass --
  // falls back to this icon/color block, same as 'Faith & Spirituality').
  Dating: { icon: '💗', color: PALETTE[1] },
};

export function categoryStyleFor(interestTag) {
  return CATEGORY_STYLES[interestTag] || { icon: '🎉', color: PALETTE[0] };
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
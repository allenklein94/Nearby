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
};

export function categoryStyleFor(interestTag) {
  return CATEGORY_STYLES[interestTag] || { icon: '🎉', color: PALETTE[0] };
}
// Ice breakers and "before you go" prep tips shown on the Gathering Hub.
// Static, per-category copy — not a per-gathering AI generation (this
// codebase has no LLM call anywhere in the gathering flow; see
// getHomeInsight in homeDashboard.js for the same no-new-API-cost
// tradeoff made for Home's "one sentence"). These are generic, honest
// advice/prompts, not a claim about this specific gathering, so they
// don't run into the "no invented numbers" convention the way a
// fabricated stat would.

const DEFAULT_ICE_BREAKERS = [
  'What brought you here today?',
  "What's kept you busy lately?",
  'Any recommendations around here?',
];

const ICE_BREAKERS = {
  Hiking: ['What trail do you recommend around here?', "What's the best hike you've done?", 'What brought you here?'],
  Outdoors: ['What trail do you recommend around here?', 'Favorite spot to get outside nearby?', 'What brought you here?'],
  Coffee: ["What's your usual order?", "What's your favorite local coffee shop?", 'What brought you here?'],
  Foodie: ["What's your favorite local restaurant?", "What's a dish you could eat every day?", 'What brought you here?'],
  Cooking: ["What's your go-to dish to cook?", 'Any restaurant recommendations nearby?', 'What brought you here?'],
  Wine: ["What's your favorite wine region?", 'Red or white?', 'What brought you here?'],
  Music: ["What have you been listening to lately?", 'Any concerts you have coming up?', 'What brought you here?'],
  Concerts: ['Best show you have ever been to?', 'Who would you love to see live?', 'What brought you here?'],
  Movies: ["What's the last movie you loved?", 'Any shows you are currently watching?', 'What brought you here?'],
  Reading: ["What are you reading right now?", "What's a book you'd recommend?", 'What brought you here?'],
  Art: ['Seen any good exhibits lately?', "What's a piece of art that stuck with you?", 'What brought you here?'],
  Museums: ['Favorite museum you have visited?', 'What kind of exhibits do you like most?', 'What brought you here?'],
  Photography: ['What do you like to photograph most?', 'Phone or camera?', 'What brought you here?'],
  Gaming: ["What have you been playing lately?", "What's a game you could play forever?", 'What brought you here?'],
  Fitness: ["What's your favorite way to work out?", 'Morning or evening workouts?', 'What brought you here?'],
  Yoga: ['How long have you been practicing?', 'Favorite style of yoga?', 'What brought you here?'],
  Running: ["What's your favorite route around here?", 'Training for anything?', 'What brought you here?'],
  Dancing: ['How did you get into dancing?', "What's your favorite style?", 'What brought you here?'],
  Sports: ["What's your team?", 'Do you play or just watch?', 'What brought you here?'],
  Travel: ["What's the best place you have traveled to?", "Where's next on your list?", 'What brought you here?'],
  Dogs: ["What's your dog's name?", "Best dog park around here?", 'What brought you here?'],
  Cats: ["Tell us about your cat.", 'Rescue or breeder?', 'What brought you here?'],
  Volunteering: ["What causes do you care about most?", 'How did you first get into volunteering?', 'What brought you here?'],
  Meditation: ['How long have you been practicing?', 'What got you started?', 'What brought you here?'],
  'Faith & Spirituality': ['What does this community mean to you?', 'How did you first get involved?', 'What brought you here?'],
};

const DEFAULT_PREP_TIPS = ['Bring water', 'Wear something comfortable', 'Charge your phone before you head out'];

const PREP_TIPS = {
  Hiking: ['Comfortable shoes', 'Bring water', 'Sunscreen'],
  Outdoors: ['Comfortable shoes', 'Bring water', 'Sunscreen'],
  Fitness: ['Workout clothes', 'Bring water', 'A towel'],
  Running: ['Running shoes', 'Bring water', 'Check the weather before you head out'],
  Yoga: ['A mat, if you have one', 'Comfortable, stretchy clothes', 'Bring water'],
  Dancing: ['Comfortable shoes you can move in', 'Come with an open mind'],
  Cooking: ['Come hungry', 'An apron, if you have one'],
  Wine: ['Eat something beforehand', 'Bring a valid ID'],
  Sports: ['Comfortable shoes', 'Bring water'],
  Volunteering: ['Comfortable clothes you don’t mind getting a little dirty', 'Bring water'],
};

export function iceBreakersFor(interestTag) {
  return ICE_BREAKERS[interestTag] ?? DEFAULT_ICE_BREAKERS;
}

export function prepTipsFor(interestTag) {
  return PREP_TIPS[interestTag] ?? DEFAULT_PREP_TIPS;
}

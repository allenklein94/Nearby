export const RELATIONSHIP_EXPERIMENTS = [
  'Take a 20-minute walk together without phones.',
  'Cook a new recipe together, even over video call.',
  'Ask each other three questions about childhood.',
  'Share a song that meant something to you growing up.',
  'Both describe your ideal ordinary Sunday, in detail.',
  "Take turns describing a place you'd love to show the other someday.",
  'Ask what "home" means to each of you.',
  'Share the last thing that made you laugh out loud.',
  "Talk about a small tradition you'd want in a relationship.",
  "Ask each other what you're proud of this month.",
  'Describe your ideal way to spend a rainy day.',
  'Share a skill you wish you had time to learn.',
  'Talk about what "feeling appreciated" looks like for each of you.',
  'Ask about a moment that changed how you see the world.',
  'Share your go-to comfort food and why.',
  'Talk about a place that feels like "yours."',
  'Ask what makes each of you feel most at ease around someone.',
  "Share a small goal you're working toward right now.",
  'Talk about how you each like to be supported on a hard day.',
  'Ask what "quality time" actually looks like for each of you.',
];

export function randomExperiment() {
  return RELATIONSHIP_EXPERIMENTS[Math.floor(Math.random() * RELATIONSHIP_EXPERIMENTS.length)];
}
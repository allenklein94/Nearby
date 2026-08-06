export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function getTimePeriod(date = new Date()) {
  const day = date.getDay();
  if (day === 0 || day === 6) return 'weekend';
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

const QUICK_PROMPTS_BY_PERIOD = {
  morning: [
    { icon: '☕', label: 'Coffee', category: 'Coffee' },
    { icon: '🏃', label: 'Morning Run', category: 'Fitness' },
    { icon: '🍳', label: 'Breakfast Meetup', category: 'Foodie' },
  ],
  afternoon: [
    { icon: '🥪', label: 'Lunch', category: 'Foodie' },
    { icon: '🤝', label: 'Volunteering', category: 'Volunteering' },
    { icon: '📚', label: 'Reading', category: 'Reading' },
  ],
  evening: [
    { icon: '🍽️', label: 'Dinner', category: 'Foodie' },
    { icon: '🎤', label: 'Concert', category: 'Concerts' },
    { icon: '🚶', label: 'Walk', category: 'Outdoors' },
  ],
  weekend: [
    { icon: '🏐', label: 'Beach Volleyball', category: 'Sports' },
    { icon: '🌱', label: 'Beach Cleanup', category: 'Outdoors' },
    { icon: '🍷', label: 'Wine Tasting', category: 'Wine' },
  ],
};

export function getQuickPrompts(period = getTimePeriod()) {
  return QUICK_PROMPTS_BY_PERIOD[period] ?? QUICK_PROMPTS_BY_PERIOD.evening;
}

export const INTENTION_OPTIONS = [
  { value: 'serious', label: 'Serious relationship', icon: '💍' },
  { value: 'casual', label: 'Casual dating', icon: '😊' },
  { value: 'friends', label: 'New friends', icon: '🤝' },
  { value: 'marriage', label: 'Marriage-minded', icon: '💒' },
  { value: 'unsure', label: 'Still figuring it out', icon: '🤔' },
];

export function intentionLabel(value) {
  const option = INTENTION_OPTIONS.find((o) => o.value === value);
  return option ? `${option.icon} ${option.label}` : null;
}
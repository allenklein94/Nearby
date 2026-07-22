export const INTENTION_OPTIONS = [
  { value: 'serious', label: 'Serious relationship', icon: '💍' },
  { value: 'casual', label: 'Casual dating', icon: '😊' },
  { value: 'friends', label: 'New friends', icon: '🤝' },
  { value: 'marriage', label: 'Marriage-minded', icon: '💒' },
  { value: 'unsure', label: 'Still figuring it out', icon: '🤔' },
];

export function intentionLabel(values) {
  if (!values) return null;
  const list = Array.isArray(values) ? values : [values];
  if (list.length === 0) return null;

  const labels = list
    .map((v) => {
      const option = INTENTION_OPTIONS.find((o) => o.value === v);
      return option ? `${option.icon} ${option.label}` : null;
    })
    .filter(Boolean);

  return labels.length > 0 ? labels.join(', ') : null;
}
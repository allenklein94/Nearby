// Accessibility props for components/ToggleRow.js: the row is announced as a switch with its on/off state, so a screen
// reader says e.g. "Dark mode, switch, on" and one double-tap toggles it.
export function toggleRowA11y({ on, disabled = false, label, hint } = {}) {
  return {
    accessible: true,
    accessibilityRole: 'switch',
    accessibilityState: { checked: !!on, disabled: !!disabled },
    accessibilityLabel: label,
    ...(hint ? { accessibilityHint: hint } : {}),
  };
}

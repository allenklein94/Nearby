// One look per button state (owner, 2026-11-21): a primary action is coral with white text (colors.primary); a disabled
// one is a muted grey, never a paler coral or a pale category colour, so "can't tap yet" never looks like "tap me" and a
// pale colour never looks disabled. Visual only: every button keeps its own `disabled` prop, action, placement and text.
// Applied to the button's container: `style={[styles.submit, disabledExpr && disabledButtonStyle(colors)]}`.
export function disabledButtonStyle(colors) {
  return { backgroundColor: colors.textTertiary, borderColor: colors.textTertiary, opacity: 0.55 };
}

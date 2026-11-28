// One look per button state (owner, 2026-11-21): a primary action is coral with white text (colors.primary); a disabled
// one is a muted grey, never a paler coral or a pale category colour, so "can't tap yet" never looks like "tap me" and a
// pale colour never looks disabled. Visual only: every button keeps its own `disabled` prop, action, placement and text.
// Applied to the button's container: `style={[styles.submit, disabledExpr && disabledButtonStyle(colors)]}`.
export function disabledButtonStyle(colors) {
  return { backgroundColor: colors.textTertiary, borderColor: colors.textTertiary, opacity: 0.55 };
}

// One full-width primary button (owner, 2026-11-28, design-system D2): every block CTA (Next, Publish, Save, Send request,
// Join, Continue...) has the same pill, height and padding; spread it into the button's style and keep the colour there
// (`{ ...PRIMARY_BUTTON, backgroundColor: colors.primary }`). Compact row actions (send arrows, Approve, inline links)
// keep their own smaller size. 48 pt high = above the 44 pt minimum touch target.
export const PRIMARY_BUTTON = {
  paddingVertical: 14,
  minHeight: 48,
  borderRadius: 999,
  alignItems: 'center',
  justifyContent: 'center',
};

// iOS: a full-screen KeyboardAvoidingView under a stack header must be offset by that header's height (the view is
// measured from below the header). Android resizes the window itself, so no offset. Used by components/KeyboardSafeView.
export function keyboardOffsetFor(platform, headerHeight) {
  return platform === 'ios' ? Math.max(0, Number(headerHeight) || 0) : 0;
}

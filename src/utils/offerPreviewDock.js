// Make an Offer's preview dock (owner, 2026-11-22): the live Customer Preview (item 49) stays reachable while the owner edits,
// without permanently taking a large part of the sheet. The dock sits below the form, outside its scroll, beside Send Offer:
// collapsed = one quiet line (the label + what the customer reads first); expanded = the ONE preview card (same renderer and
// draft as before: utils/offerDraftPreview.js + OfferCustomerBody + presentOffer), in its own bounded scroll so the form keeps
// the rest of the sheet. While the keyboard is up only Send Offer stays, so the dock never covers a field or the keyboard; the
// owner's open/closed choice comes back when the keyboard goes. Pure: no React Native imports.

// The expanded panel never takes more than this share of the window, and never more than PANEL_MAX_PX.
export const PANEL_MAX_SHARE = 0.42;
export const PANEL_MAX_PX = 420;
// Below this the panel would be too small to read a card in; it still opens (scrollable), never at a smaller height.
export const PANEL_MIN_PX = 180;

// What the dock shows right now. hasPreview = draftPreviewOffer returned a card (null before a description: item 49 shows nothing then).
export function previewDockState({ hasPreview, expanded, keyboardVisible }) {
  const showToggle = !!hasPreview && !keyboardVisible;
  return {
    showToggle,
    showPanel: showToggle && !!expanded,
    showSend: true, // Send Offer is always in the dock (its own disabled rule is unchanged)
  };
}

// Height cap for the expanded panel, from the window height (points).
export function previewPanelMaxHeight(windowHeight) {
  const h = Number(windowHeight);
  if (!Number.isFinite(h) || h <= 0) return PANEL_MIN_PX;
  return Math.round(Math.max(PANEL_MIN_PX, Math.min(PANEL_MAX_PX, h * PANEL_MAX_SHARE)));
}

// The one line the collapsed dock shows after its label: what the customer reads first on the card (title, else the
// description). Taken from the same preview row the card renders, so the two can't disagree. '' when there is no preview.
export function previewDockSummary(previewOffer) {
  if (!previewOffer) return '';
  const title = String(previewOffer.offer_title ?? '').trim();
  if (title) return title;
  return String(previewOffer.offer_description ?? '').replace(/\s+/g, ' ').trim();
}

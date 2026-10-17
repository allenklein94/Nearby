// Dating deck's four buttons (owner, 2026-10-17): the existing symbol stays and a visible word sits under it, matching
// the worded Friends deck (FRIEND_DECISIONS). Each word is the short form of that button's existing screen-reader label
// (`a11yKey`), so what you read is what the button does. Meanings are unchanged: skip = local skip (left swipe), wave =
// a Wave (never advances the deck), notice = a Notice (right swipe), rewind = back to the last skip.
export const DATING_DECK_ACTIONS = {
  rewind: { glyph: '↺', labelKey: 'ui.swipeCards.deckRewind', a11yKey: 'ui.swipeCards.rewindToThePersonYouA11y' },
  skip: { glyph: '✕', labelKey: 'ui.swipeCards.deckSkip', a11yKey: 'ui.swipeCards.skipA11y' },
  wave: { glyph: '👋', labelKey: 'ui.swipeCards.deckWave', a11yKey: 'ui.swipeCards.sendAWaveToA11y' },
  notice: { glyph: '♡', labelKey: 'ui.swipeCards.deckNotice', a11yKey: 'ui.swipeCards.sendANoticeToA11y' },
};

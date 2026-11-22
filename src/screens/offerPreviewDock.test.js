// Make an Offer's Customer Preview dock (owner, 2026-11-22), read from the screen's source: one preview, pinned under the
// scrolling form beside Send Offer, out of the keyboard's way, Send wired exactly as before.
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, 'BusinessDashboardScreen.js'), 'utf8');
const start = src.indexOf('<Modal visible={!!offerModalRequestId}');
const modal = src.slice(start, src.indexOf('</Modal>', start));
const scrollEnd = modal.lastIndexOf('</ScrollView>', modal.indexOf('<View style={styles.offerDock}>'));
const form = modal.slice(0, scrollEnd);
const dock = modal.slice(modal.indexOf('<View style={styles.offerDock}>'));
const count = (s, needle) => s.split(needle).length - 1;

describe('Make an Offer preview dock', () => {
  test('one preview implementation: the draft mapping + the customer card body, once each, in the whole screen', () => {
    expect(count(src, 'draftPreviewOffer({')).toBe(1);
    expect(count(src, '<OfferCustomerBody')).toBe(1);
    expect(count(modal, 'presentOffer(previewOffer')).toBe(1);
    expect(dock).toContain('<OfferCustomerBody offer={previewOffer}');
  });
  test('the form scrolls on its own; the preview and Send Offer are pinned under it, never inside it', () => {
    expect(form).toContain('<ScrollView style={styles.offerSheetScroll}');
    expect(form).not.toContain('<OfferCustomerBody');
    expect(form).not.toContain('handleSubmitOffer');
    expect(form).toContain("t('ui.bizDash3.cancel')"); // Cancel stays at the end of the form
    expect(scrollEnd).toBeLessThan(modal.indexOf('<View style={styles.offerDock}>'));
    expect(src).toMatch(/offerSheetScroll: \{ flexGrow: 0, flexShrink: 1 \}/);
  });
  test('closed to one line on every open; the opened card is height-capped and scrolls inside the dock', () => {
    expect(src).toContain('useEffect(() => { if (offerModalRequestId) setOfferPreviewOpen(false); }, [offerModalRequestId]);');
    expect(dock).toContain('maxHeight: Math.round(windowHeight * OFFER_PREVIEW_CARD_MAX_FRACTION)');
    expect(dock).toContain('accessibilityState={{ expanded: dock.card }}');
    expect(dock).toContain('numberOfLines={1}');
  });
  test('keyboard: the dock layout reads the keyboard, and tapping the bar while typing closes the keyboard first', () => {
    expect(src).toContain('const keyboardVisible = useKeyboardVisible();');
    expect(modal).toContain('offerPreviewDockLayout({ hasPreview: !!previewOffer, expanded: offerPreviewOpen, keyboardVisible })');
    expect(dock).toContain('if (keyboardVisible) { Keyboard.dismiss(); setOfferPreviewOpen(true); }');
    expect(dock).toContain('{dock.send && (');
    expect(dock).toContain('{dock.card && (');
  });
  test('Send Offer: same handler, same disabled rule, same labels as before the dock', () => {
    expect(modal).toContain("const sendDisabled = respondingOpportunityId === offerModalRequestId || !offerDescriptionInput.trim() || (offerTypeInput === 'alt_time' && !offerProposedTime);");
    expect(count(modal, 'onPress={handleSubmitOffer}')).toBe(1);
    expect(dock).toContain('onPress={handleSubmitOffer}');
    expect(dock).toContain('disabled={sendDisabled}');
    expect(dock).toContain("t('ui.bizDash3.sendOfferA11y')");
    expect(dock).toContain("t('ui.bizDash3.sending')");
  });
  test('no new strings: the dock uses existing keys only', () => {
    const keys = [...dock.matchAll(/t\('([^']+)'/g)].map((m) => m[1]);
    const known = new Set(['ui.bizDash3.customerPreview', 'ui.bizDash3.thisIsWhatTheCustomer', 'ui.bizDash3.previewOfTheCustomersAcceptA11y',
      'ui.bizDash3.howToRedeemIsShown', 'ui.bizDash3.textPhotosAndVideosAre', 'ui.bizDash3.sendingA11y', 'ui.bizDash3.sendOfferA11y',
      'ui.bizDash3.sending', 'ui.bizDash3.sendOffer']);
    expect(keys.filter((k) => !known.has(k))).toEqual([]);
  });
});

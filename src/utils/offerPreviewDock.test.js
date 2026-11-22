// Make an Offer preview dock (owner, 2026-11-22): rules + the screen's wiring. Pure Node (no device): the layout itself is a phone check.
import fs from 'fs';
import path from 'path';
import { previewDockState, previewPanelMaxHeight, previewDockSummary, PANEL_MAX_PX, PANEL_MIN_PX } from './offerPreviewDock';
import { draftPreviewOffer } from './offerDraftPreview';

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const dash = read('../screens/BusinessDashboardScreen.js');
const dock = read('../components/OfferPreviewDock.js');

// The offer modal's JSX only (from its <Modal> to the next <Modal>).
const offerModal = (() => {
  const a = dash.indexOf('<Modal visible={!!offerModalRequestId}');
  const b = dash.indexOf('<Modal visible={!!acceptSheetRequestId}', a);
  return dash.slice(a, b);
})();
// The form scroll closes at the last </ScrollView> before the dock (the creatives row has its own horizontal one inside it).
const formEnd = offerModal.lastIndexOf('</ScrollView>', offerModal.indexOf('<OfferPreviewDock'));
const formScroll = offerModal.slice(offerModal.indexOf('<ScrollView style={styles.offerSheetScroll}'), formEnd);
const afterScroll = offerModal.slice(formEnd);

describe('dock state', () => {
  test('nothing to preview (no description yet) = no toggle, no panel; Send stays', () => {
    expect(previewDockState({ hasPreview: false, expanded: true, keyboardVisible: false })).toEqual({ showToggle: false, showPanel: false, showSend: true });
  });
  test('collapsed by default: a toggle line only', () => {
    expect(previewDockState({ hasPreview: true, expanded: false, keyboardVisible: false })).toEqual({ showToggle: true, showPanel: false, showSend: true });
  });
  test('expanded: the panel shows', () => {
    expect(previewDockState({ hasPreview: true, expanded: true, keyboardVisible: false }).showPanel).toBe(true);
  });
  test('keyboard up: only Send stays (never covers a field or the keyboard); the choice comes back after', () => {
    const typing = previewDockState({ hasPreview: true, expanded: true, keyboardVisible: true });
    expect(typing).toEqual({ showToggle: false, showPanel: false, showSend: true });
    expect(previewDockState({ hasPreview: true, expanded: true, keyboardVisible: false }).showPanel).toBe(true);
  });
});

describe('panel height on phone sizes', () => {
  test('bounded share of the window, capped, never below the readable minimum', () => {
    expect(previewPanelMaxHeight(568)).toBe(239); // iPhone SE (1st gen) / 320 wide
    expect(previewPanelMaxHeight(667)).toBe(280); // iPhone SE 2/3
    expect(previewPanelMaxHeight(844)).toBe(354); // iPhone 14/15
    expect(previewPanelMaxHeight(932)).toBe(391); // Pro Max
    expect(previewPanelMaxHeight(1366)).toBe(PANEL_MAX_PX); // iPad / big browser window
    expect(previewPanelMaxHeight(300)).toBe(PANEL_MIN_PX);
    expect(previewPanelMaxHeight(undefined)).toBe(PANEL_MIN_PX);
  });
  test('on the smallest phone the panel leaves more than half the window to the form', () => {
    expect(previewPanelMaxHeight(568) / 568).toBeLessThan(0.5);
  });
});

describe('summary follows the live preview row', () => {
  const base = { type: 'standard', title: '', description: '', includedItems: [] };
  test('no description = no preview = no summary', () => {
    expect(draftPreviewOffer(base)).toBeNull();
    expect(previewDockSummary(draftPreviewOffer(base))).toBe('');
  });
  test('updates as the owner types: description, then the title replaces it', () => {
    const d1 = draftPreviewOffer({ ...base, description: 'Table for 4,\n  window seat' });
    expect(previewDockSummary(d1)).toBe('Table for 4, window seat');
    const d2 = draftPreviewOffer({ ...base, description: 'Table for 4', title: 'Dinner for four' });
    expect(previewDockSummary(d2)).toBe('Dinner for four');
  });
});

describe('screen wiring', () => {
  test('the preview card is rendered ONCE, only inside the dock, outside the form scroll', () => {
    expect(dash.match(/<OfferCustomerBody offer=\{previewOffer\}/g)).toHaveLength(1);
    expect(dash.match(/draftPreviewOffer\(\{/g)).toHaveLength(1);
    expect(formScroll).not.toContain('OfferCustomerBody');
    expect(formScroll).not.toContain('draftPreviewOffer');
    const dockOpen = afterScroll.indexOf('<OfferPreviewDock');
    const dockClose = afterScroll.indexOf('</OfferPreviewDock>');
    const body = afterScroll.indexOf('<OfferCustomerBody offer={previewOffer}');
    expect(dockOpen).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(dockOpen);
    expect(body).toBeLessThan(dockClose);
  });
  test('Send Offer lives in the dock, sends through the one handler, same disabled rule as before', () => {
    expect(formScroll).not.toContain('handleSubmitOffer');
    expect(offerModal.match(/onPress=\{handleSubmitOffer\}/g)).toHaveLength(1);
    expect(afterScroll).toContain('sendButton={(');
    expect(afterScroll).toContain("const sendBlocked = respondingOpportunityId === offerModalRequestId || !offerDescriptionInput.trim() || (offerTypeInput === 'alt_time' && !offerProposedTime);");
    expect(afterScroll).toContain('disabled={sendBlocked}');
    expect(dash.match(/validateOfferForm\(\)/g).length).toBeGreaterThanOrEqual(2);
  });
  test('Cancel stays at the end of the form; the five offer types are untouched', () => {
    expect(formScroll).toContain("t('ui.bizDash3.cancel')");
    expect(formScroll).toContain('{OFFER_TYPE_OPTIONS.map((o) => (');
    const types = dash.slice(dash.indexOf('const OFFER_TYPE_OPTIONS = ['), dash.indexOf('];', dash.indexOf('const OFFER_TYPE_OPTIONS = [')));
    expect(types.match(/key: '(\w+)'/g)).toEqual(["key: 'standard'", "key: 'discount'", "key: 'perk'", "key: 'upgrade'", "key: 'alt_time'"]);
  });
  test('the sheet bounds the form scroll so the dock is always on screen', () => {
    expect(dash).toContain("offerSheet: { maxHeight: '92%' }");
    expect(dash).toContain('offerSheetScroll: { flexGrow: 0, flexShrink: 1 }');
  });
  test('dock: existing label only (no new strings), keyboard aware, bounded panel, screen-reader state, no motion', () => {
    expect(afterScroll).toContain("label={t('ui.bizDash3.customerPreview')}");
    expect(dock).not.toMatch(/\bt\(['"]/); // every word comes in through props
    expect(dock).toContain("'keyboardWillShow'");
    expect(dock).toContain("'keyboardDidShow'");
    expect(dock).toContain('previewPanelMaxHeight(height)');
    expect(dock).toContain('accessibilityState={{ expanded: state.showPanel }}');
    expect(dock).toContain('nestedScrollEnabled');
    expect(dock).not.toMatch(/Animated|LayoutAnimation|animateLayout/);
  });
  test("What's included row: the input shrinks, Add never does (clipped at 320 pt, 2026-11-22)", () => {
    const row = formScroll.slice(formScroll.indexOf("t('ui.bizDash3.whatsIncludedOptional')"), formScroll.indexOf("t('ui.bizDash3.addItemA11y')"));
    expect(row).toContain('style={[styles.input, styles.inlineAddInput]}');
    expect(row).toContain('styles.inlineAddButton');
    expect(row).toContain('onPress={addOfferIncludedItem}');
    expect(dash).toContain('inlineAddInput: { flex: 1, minWidth: 0 },');
    expect(dash).toMatch(/inlineAddButton: \{ flexShrink: 0,[^}]*minHeight: 44/);
  });
});

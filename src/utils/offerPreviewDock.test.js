// Make an Offer's Customer Preview dock (owner, 2026-11-22): the rules the screen renders, fed by the real draft mapping.
import { offerPreviewDockLayout, offerPreviewSummary, OFFER_PREVIEW_CARD_MAX_FRACTION } from './offerPreviewDock';
import { draftPreviewOffer } from './offerDraftPreview';
import { tr } from '../i18n/translate';
import { offerPriceLabel } from './outcomeDisplay';

const NOW = new Date(2026, 10, 22, 12, 0, 0);
const base = { type: 'standard', description: '', price: '', discount: '', validDay: null, validTime: null, availFrom: null, availUntil: null };
const t = (key, vars) => tr(key, vars);
const formatTime = () => 'Sat 7:15 PM';
const summaryOf = (draft) => offerPreviewSummary(draftPreviewOffer({ ...base, ...draft }, NOW), { t, formatTime });

describe('offerPreviewDockLayout', () => {
  it('shows nothing to preview before there is a description, but Send stays', () => {
    expect(offerPreviewDockLayout({ hasPreview: false, expanded: true, keyboardVisible: false })).toEqual({ bar: false, card: false, send: true });
  });
  it('starts as one line with Send beside it', () => {
    expect(offerPreviewDockLayout({ hasPreview: true, expanded: false, keyboardVisible: false })).toEqual({ bar: true, card: false, send: true });
  });
  it('opens the full card on request', () => {
    expect(offerPreviewDockLayout({ hasPreview: true, expanded: true, keyboardVisible: false })).toEqual({ bar: true, card: true, send: true });
  });
  it('while the keyboard is up keeps only the one-line bar (card + Send step aside, never over the field or keyboard)', () => {
    expect(offerPreviewDockLayout({ hasPreview: true, expanded: true, keyboardVisible: true })).toEqual({ bar: true, card: false, send: false });
    expect(offerPreviewDockLayout({ hasPreview: true, expanded: false, keyboardVisible: true })).toEqual({ bar: true, card: false, send: false });
  });
  it('comes back as it was when the keyboard goes down', () => {
    expect(offerPreviewDockLayout({ hasPreview: true, expanded: true, keyboardVisible: false }).card).toBe(true);
  });
  it('the opened card never takes more than 40% of the window', () => {
    expect(OFFER_PREVIEW_CARD_MAX_FRACTION).toBeLessThanOrEqual(0.4);
  });
});

describe('offerPreviewSummary follows the draft live (same mapping as the card)', () => {
  it('no description = no preview, empty line', () => {
    expect(summaryOf({})).toBe('');
    expect(offerPreviewSummary(null, { t, formatTime })).toBe('');
  });
  it('a description alone = its first line', () => {
    expect(summaryOf({ description: "We'd love to host your group.\nSecond line" })).toBe("We'd love to host your group.");
  });
  it('a long description is shortened, never wrapped', () => {
    const s = summaryOf({ description: 'x'.repeat(120) });
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s.endsWith('…')).toBe(true);
  });
  it('the title, when given, leads instead of the description', () => {
    expect(summaryOf({ description: 'Long words', title: 'Group coffee' })).toBe('Group coffee');
  });
  it('a discount becomes the card headline, then the price', () => {
    expect(summaryOf({ type: 'discount', description: 'Hi', discount: '20' })).toBe('20% OFF');
    expect(summaryOf({ type: 'discount', description: 'Hi', discount: '20', price: '40' })).toBe(`20% OFF · ${offerPriceLabel(40)}`);
  });
  it('a discount the card would refuse (over the cap) is left out like the card leaves it out', () => {
    expect(summaryOf({ type: 'discount', description: 'Hi', discount: '60', discountCap: 30 })).toBe('Hi');
  });
  it('a discount typed on another offer type is not shown (the card shows none)', () => {
    expect(summaryOf({ type: 'standard', description: 'Hi', discount: '20' })).toBe('Hi');
  });
  it('per-person price reads as on the card', () => {
    expect(summaryOf({ description: 'Hi', price: '12', priceIsPerPerson: true })).toBe(`Hi · ${offerPriceLabel(12, true)}`);
  });
  it('an Other time offer adds its proposed time', () => {
    expect(summaryOf({ type: 'alt_time', description: 'Hi', proposedTime: new Date(2026, 10, 28, 19, 15) })).toBe('Hi · Sat 7:15 PM');
  });
});

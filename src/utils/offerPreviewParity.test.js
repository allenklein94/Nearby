// Make an Offer's live Customer Preview (item 49) shows the card the customer will get: same row mapping, same
// presentation engine, same body, same frame/header/button styles; the button is shown but never live, and the preview
// never claims the offer was screened, sent or booked.
import fs from 'fs';
import path from 'path';
import { draftPreviewOffer, previewAcceptAction } from './offerDraftPreview';
import { presentOffer } from './offerPresentationEngine';
import { offerPriceLabel } from './outcomeDisplay';
import { discountHeadlinePct } from './offerPresentation';
import { offerTimes } from './offerTimes';
import { consumerOfferAction } from './primaryAction';

const NOW = new Date(2026, 9, 12, 15, 0, 0);
const at = (h, m = 0) => { const d = new Date(NOW); d.setHours(h, m, 0, 0); return d; };
const preview = (draft) => presentOffer(draftPreviewOffer(draft, NOW), { business: { name: 'Coastal Coffee (test)' }, context: { viewer: 'owner_preview', now: NOW } });
const customer = (row) => presentOffer({ ...row, status: 'offered', created_at: NOW.toISOString() }, { business: { name: 'Coastal Coffee (test)' }, context: { now: NOW, playedIds: new Set(['x']) } });

describe('Customer Preview = the customer card', () => {
  test('price: the same label the customer sees (per person kept)', () => {
    const row = draftPreviewOffer({ type: 'package', description: 'Coffee for four', price: '24', priceIsPerPerson: true }, NOW);
    expect(offerPriceLabel(row.offer_price, row.price_is_per_person)).toBe(offerPriceLabel(24, true));
    const free = draftPreviewOffer({ type: 'package', description: 'Coffee for four', price: '' }, NOW);
    expect(free.offer_price).toBeNull();
  });

  test('discount: the headline percentage, only on a discount within the cap', () => {
    const row = draftPreviewOffer({ type: 'discount', description: '20% off', discount: '20' }, NOW);
    expect(discountHeadlinePct(row)).toBe(20);
    expect(preview({ type: 'discount', description: '20% off', discount: '20' }).discountPct).toBe(20);
    expect(draftPreviewOffer({ type: 'discount', description: 'x', discount: '90', discountCap: 50 }, NOW).discount_pct).toBeNull();
  });

  test('time options: one time, or both times, never a pick in the preview', () => {
    const one = preview({ type: 'alt_time', description: 'Table at 7', proposedTime: at(19) });
    expect(one.times).toEqual([at(19).toISOString()]);
    const two = preview({ type: 'alt_time', description: 'Table at 7 or 8', proposedTime: at(19), proposedTimeAlt: at(20) });
    expect(two.times).toEqual([at(19).toISOString(), at(20).toISOString()]);
    expect(two.pickTime).toBe(false);
    expect(offerTimes(draftPreviewOffer({ type: 'alt_time', description: 'x', proposedTime: at(19), proposedTimeAlt: at(19) }, NOW))).toHaveLength(1);
  });

  test('media: photo, video (with or without poster) and no media read as the customer card does', () => {
    const d = { type: 'package', description: 'Latte' };
    expect(preview({ ...d, creative: { media_path: 'p/a.jpg', media_type: 'image' } }).media).toEqual({ kind: 'image', path: 'p/a.jpg' });
    expect(preview({ ...d, creative: { media_path: 'p/v.mp4', media_type: 'video', poster_path: 'p/v.jpg' } }).media).toEqual({ kind: 'video', path: 'p/v.mp4', posterPath: 'p/v.jpg' });
    expect(preview({ ...d, creative: { media_path: 'p/v.mp4', media_type: 'video' } }).media.kind).toBe('video_label');
    expect(preview(d).media).toBeNull();
  });

  test('live: each edit re-derives the card (price, discount, time, media)', () => {
    const d = { type: 'package', description: 'Latte', price: '5' };
    expect(draftPreviewOffer(d, NOW).offer_price).toBe(5);
    expect(draftPreviewOffer({ ...d, price: '6' }, NOW).offer_price).toBe(6);
    expect(preview({ ...d, creative: { media_path: 'a.jpg', media_type: 'image' } }).media).not.toBeNull();
    expect(preview({ type: 'alt_time', description: 'x', proposedTime: at(18) }).times).not.toEqual(preview({ type: 'alt_time', description: 'x', proposedTime: at(19) }).times);
  });

  test('same lines as the customer\'s open card; never screened, sent or booked', () => {
    const draft = { type: 'discount', description: '20% off', discount: '20' };
    const p = preview(draft);
    const c = customer(draftPreviewOffer(draft, NOW));
    expect(p.card).toBe('open');
    expect(p.statusLine).toBe(c.statusLine);
    expect(p.heard).toBe(c.heard);
    expect(p.confirmation).toBeNull();
    expect(p.redemption).toBeNull();
    expect(p.rendering).toBe('static');
  });

  test('the button: the customer\'s own words, never live', () => {
    const a = previewAcceptAction();
    expect(a.disabled).toBe(true);
    expect(a.label).toBe(consumerOfferAction({ status: 'offered' }, { request: { status: 'open' } }).label);
  });

  test('both screens share the card frame/header/button styles; the preview button has no press handler', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const dash = read('screens/BusinessDashboardScreen.js');
    const detail = read('screens/BusinessRequestDetailScreen.js');
    expect(detail).toContain('...offerCardStyleSpec(colors)');
    const block = dash.slice(dash.indexOf('const previewOffer = draftPreviewOffer('), dash.indexOf('onPress={handleSubmitOffer}'));
    expect(block).toContain('getOfferCardStyles(colors)');
    expect(block).toContain('<View style={cardStyles.offerCard}>');
    expect(block).toContain('<OfferCustomerBody offer={previewOffer}');
    const button = block.slice(block.indexOf('cardStyles.acceptButton'), block.indexOf('</View>', block.indexOf('cardStyles.acceptButton')));
    expect(button).toContain('pointerEvents="none"');
    expect(button).toContain('accessibilityState={{ disabled: previewAction.disabled }}');
    expect(button).not.toMatch(/onPress|TouchableOpacity|Pressable/);
    // no customer identity in the preview (item: requester name never before acceptance)
    expect(block).not.toMatch(/requester|display_name|first_name|full_name/);
  });
});

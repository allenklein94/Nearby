import fs from 'fs';
import path from 'path';
import { draftPreviewOffer } from './offerDraftPreview';

// Local wall-clock "now" (never a UTC Z string): Mon 12 Oct 2026, 3 PM.
const NOW = new Date(2026, 9, 12, 15, 0, 0);
const at = (h, m = 0) => { const d = new Date(NOW); d.setHours(h, m, 0, 0); return d; };
const base = { type: 'discount', description: '20% off any dinner', discount: '20' };

describe('item 49: live Customer Preview from the offer draft', () => {
  test('nothing to preview until there is a description (Send requires one); no placeholder', () => {
    expect(draftPreviewOffer({ ...base, description: '' }, NOW)).toBeNull();
    expect(draftPreviewOffer({ ...base, description: '   ' }, NOW)).toBeNull();
    expect(draftPreviewOffer(null, NOW)).toBeNull();
  });

  test('"20% off tonight": the fields map to the customer row exactly as Send stores them', () => {
    const o = draftPreviewOffer({
      ...base, title: ' 20% off tonight ', price: '30', priceIsPerPerson: true,
      validDay: 'today', validTime: at(21), availFrom: at(17), availUntil: at(21), includedItems: ['Dessert'],
    }, NOW);
    expect(o).toMatchObject({
      offer_type: 'discount', offer_title: '20% off tonight', offer_description: '20% off any dinner',
      discount_pct: 20, offer_price: 30, price_is_per_person: true, included_items: ['Dessert'],
      available_from: '17:00', available_until: '21:00', valid_until: at(21).toISOString(), proposed_time: null,
    });
  });

  test('updates live: each edit changes the preview', () => {
    const a = draftPreviewOffer({ ...base, discount: '15' }, NOW);
    const b = draftPreviewOffer({ ...base, discount: '25' }, NOW);
    expect(a.discount_pct).toBe(15);
    expect(b.discount_pct).toBe(25);
  });

  test('a piece Send would refuse is left out, never shown as if it would go', () => {
    const o = draftPreviewOffer({
      ...base, discount: '40', discountCap: 30, validDay: 'today', validTime: at(14), availFrom: at(17), availUntil: null, price: '-5',
    }, NOW);
    expect(o.discount_pct).toBeNull(); // above the business's limit
    expect(o.valid_until).toBeNull(); // end time already passed
    expect(o.available_from).toBeNull(); // half a window
    expect(o.available_until).toBeNull();
    expect(o.offer_price).toBeNull();
    expect(draftPreviewOffer({ ...base, validDay: 'today', validTime: null }, NOW).valid_until).toBeNull();
  });

  test('only a discount offer carries a percentage; only an alternative carries a proposed time', () => {
    expect(draftPreviewOffer({ ...base, type: 'standard' }, NOW).discount_pct).toBeNull();
    expect(draftPreviewOffer({ ...base, type: 'standard', proposedTime: at(19) }, NOW).proposed_time).toBeNull();
    expect(draftPreviewOffer({ ...base, type: 'alt_time', proposedTime: at(19) }, NOW).proposed_time).toBe(at(19).toISOString());
    expect(draftPreviewOffer({ ...base, type: 'alt_time', proposedTime: null }, NOW).proposed_time).toBeNull();
  });

  test('a saved creative previews from storage; none = no media', () => {
    const o = draftPreviewOffer({ ...base, creative: { media_path: 'p/x.jpg', media_type: 'image', poster_path: null } }, NOW);
    expect(o).toMatchObject({ media_path: 'p/x.jpg', media_type: 'image' });
    expect(draftPreviewOffer(base, NOW).media_path).toBeNull();
  });

  test('the dashboard shows it live in the form, above Send Offer, with no separate preview step', () => {
    const dash = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
    const form = dash.slice(dash.indexOf("t('ui.bizDash3.makeAnOffer')"), dash.indexOf('<Modal visible={!!acceptSheetRequestId}'));
    expect(form).toContain('draftPreviewOffer(');
    expect(form.indexOf('draftPreviewOffer(')).toBeLessThan(form.indexOf('onPress={handleSubmitOffer}'));
    expect(dash).not.toContain('offerPreviewing');
    expect(dash).not.toContain('handlePreviewOffer');
    expect(dash).not.toContain("t('ui.bizDash3.previewOffer')");
    // the preview never sends, uploads or screens anything
    const helper = fs.readFileSync(path.join(__dirname, 'offerDraftPreview.js'), 'utf8');
    expect(helper.match(/^import .*$/gm)).toEqual([
      "import { validUntilFromChoice, availableWindowFromChoice } from './offerMedia';",
      "import { parseDiscountPct, discountCapProblem } from './discountCap';",
    ]);
  });
});

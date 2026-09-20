import fs from 'fs';
import path from 'path';

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

describe('customer preview before publishing (item 84)', () => {
  const dash = read('../screens/BusinessDashboardScreen.js');
  const detail = read('../screens/BusinessRequestDetailScreen.js');
  const body = read('../components/OfferCustomerBody.js');

  test('the preview and the real customer offer card share ONE body component', () => {
    expect(dash).toContain('<OfferCustomerBody offer={previewOffer}');
    expect(detail).toContain('<OfferCustomerBody offer={o}');
    // the customer screen no longer hand-renders the offered body
    const offered = detail.slice(detail.indexOf('<OfferReveal offerId'), detail.indexOf('</OfferReveal>'));
    expect(offered).not.toContain('offer_description');
  });
  test('the body renders every customer-visible field from the stored field names', () => {
    for (const f of ['offer_description', 'included_items', 'proposed_time', 'offer_price', 'available_from', 'valid_until', 'media_path']) expect(body).toContain(f);
    // redemption instructions are deliberately not part of the pre-accept body
    expect(body).not.toContain('redemption');
  });
  test('the offer form leads to Preview, and only the preview step sends', () => {
    expect(dash).toContain('onPress={handlePreviewOffer}');
    expect(dash).toContain('Back to edit');
    // Preview and Send share one validation
    expect(dash.match(/validateOfferForm\(\)/g).length).toBeGreaterThanOrEqual(3);
    expect(dash).toContain('Nothing is sent until you tap Send Offer');
  });
  test('the preview says what is not shown before accept, and that content is checked', () => {
    expect(dash).toContain('is shown to the customer once they accept');
    expect(dash).toContain('are checked before an offer is sent');
  });
});

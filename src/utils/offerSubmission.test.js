import fs from 'fs';
import path from 'path';
import { submissionView, needsChangesExplanation, inFlightRequestIds, payloadToForm, CATEGORY_PHRASES } from './offerSubmission';

describe('async offer screening (item 83)', () => {
  test('each stored state reads as the promised wording', () => {
    expect(submissionView({ status: 'reviewing' }).headline).toBe('Reviewing your offer…');
    expect(submissionView({ status: 'published' }).headline).toBe('Offer sent');
    expect(submissionView({ status: 'needs_changes', matched_categories: [] }).headline).toBe('Needs changes');
    expect(submissionView({ status: 'unavailable' }).actions).toEqual(['retry', 'dismiss']);
    expect(submissionView({ status: 'reviewing' }).actions).toEqual([]);
    expect(submissionView({ status: 'nonsense' })).toBeNull();
  });
  test('needs changes explains with the fixed category vocabulary, never model text', () => {
    expect(needsChangesExplanation({ matched_categories: ['weapons'] })).toMatch(/weapons/);
    expect(needsChangesExplanation({ matched_categories: ['weapons', 'fraud_scams'] })).toMatch(/weapons and fraud or scams/);
    expect(needsChangesExplanation({ matched_categories: ['made_up'] })).toMatch(/didn't pass/);
    expect(needsChangesExplanation({ reason: 'Pick an end time that is later than now.' })).toMatch(/end time/);
    expect(Object.keys(CATEGORY_PHRASES)).toHaveLength(13);
  });
  test('an in-flight offer blocks a second send on that request only', () => {
    const ids = inFlightRequestIds([
      { request_id: 'a', status: 'reviewing' }, { request_id: 'b', status: 'published' },
      { request_id: 'c', status: 'needs_changes' }, { request_id: 'd', status: 'unavailable' },
    ]);
    expect([...ids].sort()).toEqual(['a', 'd']);
  });
  test('the saved payload refills the editor', () => {
    expect(payloadToForm({ offerDescription: 'x', offerPrice: 12.5, discountPct: 20, includedItems: ['a'] })).toMatchObject({ description: 'x', price: '12.5', discount: '20', items: ['a'] });
  });
  test('the edge function queues, screens in the background and never publishes before it clears', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../supabase/functions/screen-business-content/index.ts'), 'utf8');
    expect(src).toContain("body.async === true");
    expect(src).toContain('waitUntil');
    expect(src).toContain("status: 'unavailable'"); // an outage is retryable, not published
    // publishing still happens only inside the low-tier branch of the shared screening run
    expect(src.match(/rpc\('submit_business_offer'/g)).toHaveLength(1);
    expect(src).toContain("status: 'in_review'");
  });
  test('the dashboard sends the full offer editor through the queue and blocks a second send', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
    expect(src).toContain('queue: true');
    expect(src).toContain('offerInFlight.has(o.request_id)');
    expect(src).toContain('Reviewing your offer…');
  });
});

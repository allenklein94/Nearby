import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SPONSORED_TERMS_VERSION, SPONSORED_TERMS_TEXT } from '../constants/sponsoredTerms';

const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270159_sponsored_terms_and_owner_cancel.sql'), 'utf8');
const panel = fs.readFileSync(path.join(__dirname, '../components/SponsoredPromotionsPanel.js'), 'utf8');

describe('sponsored terms are an immutable, provable version', () => {
  it('the recorded sha256 for this version matches the text exactly (change a word = new version + new hash)', () => {
    const hash = crypto.createHash('sha256').update(SPONSORED_TERMS_TEXT).digest('hex');
    const m = new RegExp(`values \\('${SPONSORED_TERMS_VERSION}', '([0-9a-f]{64})'`).exec(migration);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(hash);
  });
  it('states the locked v1 decisions', () => {
    expect(SPONSORED_TERMS_TEXT).toMatch(/10 miles/);
    expect(SPONSORED_TERMS_TEXT).toMatch(/\$25/);
    expect(SPONSORED_TERMS_TEXT).toMatch(/one business per category per local area/);
    expect(SPONSORED_TERMS_TEXT).toMatch(/cancel in the app for a full refund/);
    expect(SPONSORED_TERMS_TEXT).toMatch(/on behalf of the business/);
  });
  it('carries no unresolved counsel placeholders', () => {
    expect(SPONSORED_TERMS_TEXT).not.toMatch(/\[|counsel/i);
  });
  it('the purchase button stays disabled until the box is ticked, and sends the shown version', () => {
    expect(panel).toMatch(/canSubmit = !busy && startDate && !slotProblem && title\.trim\(\)\.length > 0 && accepted/);
    expect(panel).toMatch(/termsVersion: SPONSORED_TERMS_VERSION, acceptedTerms: accepted/);
    expect(panel).toMatch(/useState\(false\);\s*\n\s*const \[termsOpen/);
  });
});

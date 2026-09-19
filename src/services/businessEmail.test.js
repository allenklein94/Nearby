jest.mock('./supabase', () => ({ supabase: {}, functionUrl: () => '' }));
import { businessEmailReasonCopy } from './businessEmail';

describe('businessEmailReasonCopy', () => {
  it('explains each known reason in plain words', () => {
    expect(businessEmailReasonCopy('email_not_configured')).toMatch(/aren't switched on/);
    expect(businessEmailReasonCopy('wrong_code')).toMatch(/doesn't match/);
    expect(businessEmailReasonCopy('code_expired')).toMatch(/expired/);
    expect(businessEmailReasonCopy('too_many_attempts')).toMatch(/Too many/);
  });
  it('falls back to a calm generic line for unknown/provider errors, never the raw reason', () => {
    expect(businessEmailReasonCopy('provider_error_500')).not.toMatch(/provider_error/);
  });
});

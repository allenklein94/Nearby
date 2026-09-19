import { isAllDeclined } from './requestOutcome';

const open = { status: 'open' };
const o = (status) => ({ status });

describe('isAllDeclined', () => {
  it('is true when every offer passed on an open request', () => {
    expect(isAllDeclined(open, [o('declined'), o('withdrawn')])).toBe(true);
  });
  it('is false while any offer is live or won', () => {
    expect(isAllDeclined(open, [o('declined'), o('pending')])).toBe(false);
    expect(isAllDeclined(open, [o('declined'), o('offered')])).toBe(false);
    expect(isAllDeclined(open, [o('declined'), o('accepted')])).toBe(false);
  });
  it('is false when nobody actually passed (only expired/cancelled) or nothing was sent', () => {
    expect(isAllDeclined(open, [o('expired')])).toBe(false);
    expect(isAllDeclined(open, [])).toBe(false);
  });
  it('is false once the request is not open', () => {
    expect(isAllDeclined({ status: 'cancelled' }, [o('declined')])).toBe(false);
  });
});

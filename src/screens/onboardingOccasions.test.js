import { OCCASION_OPTIONS, PERSONAL_OCCASION_TYPE_KEYS, ONBOARDING_OCCASION_KEYS } from '../constants/businessAttributes';

describe('onboarding occasion tiles', () => {
  it('only offers real, personal occasion types with a label', () => {
    ONBOARDING_OCCASION_KEYS.forEach((k) => {
      expect(PERSONAL_OCCASION_TYPE_KEYS).toContain(k);
      expect(OCCASION_OPTIONS.find((o) => o.key === k)).toBeTruthy();
    });
  });
});

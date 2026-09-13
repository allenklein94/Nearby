import {
  deriveAddonRequestState,
  addonStateCopy,
  canRetryAddon,
  summarizePlanAddonReadiness,
  summarizeAddonsByType,
} from './planAddonReadiness';

describe('deriveAddonRequestState', () => {
  test('no request at all is "none"', () => {
    expect(deriveAddonRequestState(null, [])).toBe('none');
  });

  test('cancelled request is "skipped"', () => {
    expect(deriveAddonRequestState({ status: 'cancelled' }, [])).toBe('skipped');
  });

  test('fulfilled request is "confirmed"', () => {
    expect(deriveAddonRequestState({ status: 'fulfilled' }, [])).toBe('confirmed');
  });

  test('open request with an accepted offer is "confirmed" even before status syncs', () => {
    expect(deriveAddonRequestState({ status: 'open' }, [{ status: 'accepted' }])).toBe('confirmed');
  });

  test('open request with no offers yet is "pending"', () => {
    expect(deriveAddonRequestState({ status: 'open' }, [])).toBe('pending');
  });

  test('open request with a pending offer is "pending"', () => {
    expect(deriveAddonRequestState({ status: 'open' }, [{ status: 'pending' }])).toBe('pending');
  });

  test('open request with an offered offer is "offered"', () => {
    expect(deriveAddonRequestState({ status: 'open' }, [{ status: 'pending' }, { status: 'offered' }])).toBe('offered');
  });

  test('open request where every offer was declined is "declined"', () => {
    expect(deriveAddonRequestState({ status: 'open' }, [{ status: 'declined' }, { status: 'declined' }])).toBe('declined');
  });

  test('one business declining does not affect the overall state while another offer is still live', () => {
    expect(deriveAddonRequestState({ status: 'open' }, [{ status: 'declined' }, { status: 'offered' }])).toBe('offered');
  });

  test('expired request with a genuine offer is "expired_with_offer"', () => {
    expect(deriveAddonRequestState({ status: 'expired' }, [{ status: 'offered' }])).toBe('expired_with_offer');
  });

  test('expired request with no offer at all is "no_response"', () => {
    expect(deriveAddonRequestState({ status: 'expired' }, [])).toBe('no_response');
  });
});

describe('addonStateCopy', () => {
  test('returns real copy for a known state and falls back for unknown', () => {
    expect(addonStateCopy('confirmed').short).toBe('✓ Confirmed');
    expect(addonStateCopy('bogus')).toEqual(addonStateCopy('none'));
  });
});

describe('canRetryAddon', () => {
  test('retryable states', () => {
    ['none', 'declined', 'no_response', 'expired_with_offer', 'skipped'].forEach((s) => {
      expect(canRetryAddon(s)).toBe(true);
    });
  });

  test('non-retryable (already in play) states', () => {
    ['pending', 'offered', 'confirmed'].forEach((s) => {
      expect(canRetryAddon(s)).toBe(false);
    });
  });
});

describe('summarizePlanAddonReadiness', () => {
  test('no add-ons added, primary confirmed -> Ready', () => {
    expect(summarizePlanAddonReadiness(true, [])).toBe('Ready');
  });

  test('no add-ons added, primary not confirmed -> waiting on the reservation', () => {
    expect(summarizePlanAddonReadiness(false, [])).toBe('Waiting on your reservation');
  });

  test('add-ons added but primary not confirmed yet -> still waiting on the reservation', () => {
    const addons = [{ state: 'confirmed' }, { state: 'pending' }];
    expect(summarizePlanAddonReadiness(false, addons)).toBe('Waiting on your reservation');
  });

  test('all added extras confirmed -> Ready, everything confirmed', () => {
    const addons = [{ state: 'confirmed' }, { state: 'confirmed' }, { state: 'none' }];
    expect(summarizePlanAddonReadiness(true, addons)).toBe('Ready — everything is confirmed');
  });

  test('partial confirmation with something still pending -> N of M extras confirmed', () => {
    const addons = [{ state: 'confirmed' }, { state: 'pending' }, { state: 'offered' }];
    expect(summarizePlanAddonReadiness(true, addons)).toBe('1 of 3 extras confirmed');
  });

  test('partial confirmation with a genuine decline -> flags it needs attention', () => {
    const addons = [{ state: 'confirmed' }, { state: 'declined' }];
    expect(summarizePlanAddonReadiness(true, addons)).toBe('1 of 2 extras confirmed — one needs attention');
  });

  test('a skipped (explicitly removed) addon does not count against the ratio, but a genuine decline still flags attention', () => {
    const addons = [{ state: 'confirmed' }, { state: 'declined' }, { state: 'skipped' }];
    expect(summarizePlanAddonReadiness(true, addons)).toBe('1 of 2 extras confirmed — one needs attention');
  });

  test('all remaining (non-skipped) extras confirmed reads Ready even with a skipped one alongside', () => {
    const addons = [{ state: 'confirmed' }, { state: 'confirmed' }, { state: 'skipped' }];
    expect(summarizePlanAddonReadiness(true, addons)).toBe('Ready — everything is confirmed');
  });
});

describe('summarizeAddonsByType', () => {
  const types = [
    { key: 'flowers', label: 'Flowers', icon: '🌸' },
    { key: 'photographer', label: 'Photographer', icon: '📸' },
  ];

  test('a type with no request rows at all is "none"', () => {
    const result = summarizeAddonsByType(types, []);
    expect(result).toEqual([
      { key: 'flowers', label: 'Flowers', icon: '🌸', requestId: null, state: 'none', canRetry: true },
      { key: 'photographer', label: 'Photographer', icon: '📸', requestId: null, state: 'none', canRetry: true },
    ]);
  });

  test('picks the most recent attempt when a type was retried after a cancel', () => {
    const rows = [
      { id: 'old', addon_type: 'flowers', status: 'cancelled', created_at: '2026-01-01T00:00:00Z', business_request_offers: [] },
      { id: 'new', addon_type: 'flowers', status: 'open', created_at: '2026-01-02T00:00:00Z', business_request_offers: [{ status: 'offered' }] },
    ];
    const result = summarizeAddonsByType(types, rows);
    const flowers = result.find((r) => r.key === 'flowers');
    expect(flowers.requestId).toBe('new');
    expect(flowers.state).toBe('offered');
    expect(flowers.canRetry).toBe(false);
  });

  test('independent lifecycles: one type confirmed does not affect another type still pending', () => {
    const rows = [
      { id: 'a', addon_type: 'flowers', status: 'fulfilled', created_at: '2026-01-01T00:00:00Z', business_request_offers: [{ status: 'accepted' }] },
      { id: 'b', addon_type: 'photographer', status: 'open', created_at: '2026-01-01T00:00:00Z', business_request_offers: [] },
    ];
    const result = summarizeAddonsByType(types, rows);
    expect(result.find((r) => r.key === 'flowers').state).toBe('confirmed');
    expect(result.find((r) => r.key === 'photographer').state).toBe('pending');
  });
});

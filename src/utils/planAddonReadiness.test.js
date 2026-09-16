import {
  deriveAddonRequestState,
  addonStateCopy,
  canRetryAddon,
  parsePlanTimeMinutes,
  formatPlanTimeLabel,
  buildPlanTimeline,
  summarizePlanTimelineReadiness,
  buildPlanSummary,
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

describe('parsePlanTimeMinutes', () => {
  test('parses HH:MM and HH:MM:SS alike', () => {
    expect(parsePlanTimeMinutes('06:30')).toBe(390);
    expect(parsePlanTimeMinutes('18:30:00')).toBe(1110);
    expect(parsePlanTimeMinutes('00:00')).toBe(0);
    expect(parsePlanTimeMinutes('23:59')).toBe(1439);
  });

  test('null/unset/malformed all honestly return null, never a guessed position', () => {
    expect(parsePlanTimeMinutes(null)).toBeNull();
    expect(parsePlanTimeMinutes(undefined)).toBeNull();
    expect(parsePlanTimeMinutes('')).toBeNull();
    expect(parsePlanTimeMinutes('not a time')).toBeNull();
    expect(parsePlanTimeMinutes('25:00')).toBeNull();
  });
});

describe('formatPlanTimeLabel', () => {
  test('formats a real time string', () => {
    expect(formatPlanTimeLabel('18:30:00')).toBe('6:30 PM');
    expect(formatPlanTimeLabel('06:30')).toBe('6:30 AM');
  });

  test('null when unset', () => {
    expect(formatPlanTimeLabel(null)).toBeNull();
  });
});

describe('buildPlanTimeline', () => {
  const primary = {
    id: 'primary',
    category: 'Foodie',
    status: 'open',
    plan_time: null,
    plan_label: null,
    created_at: '2026-01-01T00:00:00Z',
  };

  test('no primary -> empty timeline', () => {
    expect(buildPlanTimeline({ primary: null })).toEqual([]);
  });

  test('primary alone, no add-ons, no time set -> one entry, Anytime', () => {
    const result = buildPlanTimeline({ primary, primaryOffers: [] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'primary', label: 'Foodie', planTimeLabel: 'Anytime', hasTime: false, state: 'pending' });
  });

  test('sorts multiple add-ons of the SAME type into the real chronological order (two rides, two different times)', () => {
    const addons = [
      { id: 'ride-home', addon_type: 'transportation', status: 'open', plan_time: '22:30:00', plan_label: 'Ride home', created_at: '2026-01-01T00:00:01Z', business_request_offers: [] },
      { id: 'ride-there', addon_type: 'transportation', status: 'open', plan_time: '18:30:00', plan_label: 'Ride to dinner', created_at: '2026-01-01T00:00:00Z', business_request_offers: [] },
    ];
    const result = buildPlanTimeline({ primary, primaryOffers: [], addons });
    expect(result.map((e) => e.id)).toEqual(['ride-there', 'ride-home', 'primary']);
    expect(result.map((e) => e.label)).toEqual(['Ride to dinner', 'Ride home', 'Foodie']);
  });

  test('a cancelled add-on is absent from the timeline entirely, not shown as a ghost "skipped" row', () => {
    const addons = [
      { id: 'gone', addon_type: 'flowers', status: 'cancelled', plan_time: '10:00', created_at: '2026-01-01T00:00:00Z', business_request_offers: [] },
    ];
    const result = buildPlanTimeline({ primary, primaryOffers: [], addons });
    expect(result.map((e) => e.id)).toEqual(['primary']);
  });

  test('a real accepted offer\'s own proposed_time is a valid fallback time when plan_time was never manually set', () => {
    const addons = [
      { id: 'music', addon_type: 'entertainment', status: 'open', plan_time: null, created_at: '2026-01-01T00:00:00Z',
        business_request_offers: [{ status: 'accepted', proposed_time: '2026-06-01T21:00:00.000Z', brand_partners: { name: 'The Venue' } }] },
    ];
    const result = buildPlanTimeline({ primary, primaryOffers: [], addons });
    const music = result.find((e) => e.id === 'music');
    expect(music.state).toBe('confirmed');
    expect(music.businessName).toBe('The Venue');
    expect(music.hasTime).toBe(true);
  });

  test('untimed entries never affect one another\'s independent state -- one declined add-on does not sink another still-pending one', () => {
    const addons = [
      { id: 'declined-one', addon_type: 'gift', status: 'open', created_at: '2026-01-01T00:00:00Z', business_request_offers: [{ status: 'declined' }] },
      { id: 'pending-one', addon_type: 'dessert', status: 'open', created_at: '2026-01-01T00:00:00Z', business_request_offers: [] },
    ];
    const result = buildPlanTimeline({ primary, primaryOffers: [], addons });
    expect(result.find((e) => e.id === 'declined-one').state).toBe('declined');
    expect(result.find((e) => e.id === 'pending-one').state).toBe('pending');
  });
});

describe('summarizePlanTimelineReadiness', () => {
  const confirmedPrimary = { kind: 'primary', state: 'confirmed' };
  const pendingPrimary = { kind: 'primary', state: 'pending' };

  test('no add-ons, primary confirmed -> Ready', () => {
    expect(summarizePlanTimelineReadiness([confirmedPrimary])).toBe('Ready');
  });

  test('no add-ons, primary not confirmed -> waiting on the reservation', () => {
    expect(summarizePlanTimelineReadiness([pendingPrimary])).toBe('Waiting on your reservation');
  });

  test('add-ons present but primary not confirmed yet -> still waiting on the reservation', () => {
    const timeline = [pendingPrimary, { kind: 'addon', state: 'confirmed' }];
    expect(summarizePlanTimelineReadiness(timeline)).toBe('Waiting on your reservation');
  });

  test('all add-ons confirmed -> Ready, everything confirmed', () => {
    const timeline = [confirmedPrimary, { kind: 'addon', state: 'confirmed' }, { kind: 'addon', state: 'confirmed' }];
    expect(summarizePlanTimelineReadiness(timeline)).toBe('Ready — everything is confirmed');
  });

  test('partial confirmation -> N of M extras confirmed', () => {
    const timeline = [confirmedPrimary, { kind: 'addon', state: 'confirmed' }, { kind: 'addon', state: 'pending' }, { kind: 'addon', state: 'offered' }];
    expect(summarizePlanTimelineReadiness(timeline)).toBe('1 of 3 extras confirmed');
  });

  test('a genuine decline flags "needs attention"', () => {
    const timeline = [confirmedPrimary, { kind: 'addon', state: 'confirmed' }, { kind: 'addon', state: 'declined' }];
    expect(summarizePlanTimelineReadiness(timeline)).toBe('1 of 2 extras confirmed — one needs attention');
  });
});

describe('buildPlanSummary', () => {
  const basePrimary = {
    status: 'open',
    category: 'Restaurants',
    plan_label: null,
    date: '2026-09-19',
    time_window_start: '19:00:00',
    time_window_end: null,
    party_size: 8,
  };

  test('no primary request -> null', () => {
    expect(buildPlanSummary({ primary: null })).toBeNull();
  });

  test('open request with no offers yet -> Planning, time falls back to the requested window', () => {
    const summary = buildPlanSummary({ primary: basePrimary, primaryOffers: [] });
    expect(summary.statusKind).toBe('planning');
    expect(summary.statusLabel).toBe('Planning');
    expect(summary.dateLabel).toMatch(/Sep 19/);
    expect(summary.timeLabel).toBe('7 PM');
    expect(summary.location).toBeNull();
    expect(summary.partySize).toBe(8);
  });

  test('an accepted offer -> Confirmed, with the real business name as location', () => {
    const summary = buildPlanSummary({
      primary: basePrimary,
      primaryOffers: [{ status: 'accepted', proposed_time: '2026-09-19T19:30:00Z', brand_partners: { name: 'Il Forno' } }],
      planTitle: "Sarah's Birthday 🎂",
    });
    expect(summary.statusKind).toBe('confirmed');
    expect(summary.title).toBe("Sarah's Birthday 🎂");
    expect(summary.location).toBe('Il Forno');
  });

  test('a manually-set plan_time overrides the requested window', () => {
    const summary = buildPlanSummary({ primary: { ...basePrimary, plan_time: '20:00:00' }, primaryOffers: [] });
    expect(summary.timeLabel).toBe('8 PM');
  });

  test('a cancelled request is honestly "Cancelled" even with an accepted offer on record', () => {
    const summary = buildPlanSummary({
      primary: { ...basePrimary, status: 'cancelled' },
      primaryOffers: [{ status: 'accepted' }],
    });
    expect(summary.statusKind).toBe('cancelled');
    expect(summary.statusLabel).toBe('Cancelled');
  });

  test('falls back to category, then a generic label, when there is no plan title or plan_label', () => {
    const summary = buildPlanSummary({ primary: basePrimary, primaryOffers: [] });
    expect(summary.title).toBe('Restaurants');
    const summaryNoCategory = buildPlanSummary({ primary: { ...basePrimary, category: null }, primaryOffers: [] });
    expect(summaryNoCategory.title).toBe('Your Plan');
  });
});

// Owner item 147: business request pipeline New -> Reviewing -> Offered -> Won -> Completed. New / Reviewing / Offered /
// Won are current state (no date window); Completed is redeemed in the current calendar month.
const fs = require('fs');
const path = require('path');
const { businessPipeline, isPipelineNew, isPipelineOffered, isPipelineWon, isCompletedThisMonth, PIPELINE_STAGES } = require('./businessPipeline');
const { dashboardGlance } = require('./dashboardGlance');
const { translate } = require('../i18n/translate');

const NOW = new Date(2026, 9, 15, 14, 0); // Oct 15 2026, 2 PM local
const open = { status: 'open', expires_at: new Date(2026, 9, 20).toISOString() };
const row = (over) => ({ id: over.id, request_id: over.request_id ?? `r${over.id}`, status: 'pending', business_requests: open, ...over });

describe('item 147: business request pipeline', () => {
  test('the five stages, in order', () => {
    expect(PIPELINE_STAGES).toEqual(['new', 'reviewing', 'offered', 'won', 'completed']);
  });

  test('New = still-answerable requests, whenever they were created; closed / expired / declined never count', () => {
    const oldButOpen = row({ id: 1, created_at: '2025-01-01T00:00:00Z' });
    expect(isPipelineNew(oldButOpen, new Set(), NOW)).toBe(true);
    expect(isPipelineNew(row({ id: 2, business_requests: { status: 'expired' } }), new Set(), NOW)).toBe(false);
    expect(isPipelineNew(row({ id: 3, business_requests: { status: 'cancelled' } }), new Set(), NOW)).toBe(false);
    expect(isPipelineNew(row({ id: 4, business_requests: { status: 'open', expires_at: new Date(2026, 9, 1).toISOString() } }), new Set(), NOW)).toBe(false);
    expect(isPipelineNew(row({ id: 5, status: 'declined' }), new Set(), NOW)).toBe(false);
  });

  test('Reviewing = replies Nearby is still checking; such a request leaves New (no double count)', () => {
    const opps = [row({ id: 1, request_id: 'r1' }), row({ id: 2, request_id: 'r2' })];
    const subs = [{ request_id: 'r1', status: 'reviewing' }, { request_id: 'r9', status: 'in_review' }, { request_id: 'r2', status: 'needs_changes' }];
    const p = businessPipeline(opps, subs, { now: NOW });
    expect(p.reviewing).toBe(2);
    expect(p.new).toBe(1); // r2 stays New: its reply needs changes, so the business must act again
  });

  test('Offered = awaiting the customer, whenever sent; expired or resolved offers never count', () => {
    expect(isPipelineOffered(row({ id: 1, status: 'offered', responded_at: '2025-03-01T00:00:00Z' }), NOW)).toBe(true);
    expect(isPipelineOffered(row({ id: 2, status: 'offered', valid_until: new Date(2026, 9, 15, 13).toISOString() }), NOW)).toBe(false);
    expect(isPipelineOffered(row({ id: 3, status: 'offered', business_requests: { status: 'fulfilled' } }), NOW)).toBe(false);
    expect(isPipelineOffered(row({ id: 4, status: 'offered', business_requests: { status: 'cancelled' } }), NOW)).toBe(false);
    for (const status of ['declined', 'withdrawn', 'expired', 'accepted', 'completed']) {
      expect(isPipelineOffered(row({ id: 5, status }), NOW)).toBe(false);
    }
  });

  test('Won = booked, not yet redeemed; a redeemed or cancelled booking or a no-show is not Won', () => {
    expect(isPipelineWon(row({ id: 1, status: 'accepted' }))).toBe(true);
    expect(isPipelineWon(row({ id: 2, status: 'completed' }))).toBe(false);
    expect(isPipelineWon(row({ id: 3, status: 'cancelled' }))).toBe(false);
    expect(isPipelineWon(row({ id: 4, status: 'accepted' }), new Set([4]))).toBe(false);
  });

  test('Completed = redeemed this calendar month only', () => {
    expect(isCompletedThisMonth(row({ id: 1, status: 'completed', completed_at: new Date(2026, 9, 1, 0, 5).toISOString() }), NOW)).toBe(true);
    expect(isCompletedThisMonth(row({ id: 2, status: 'completed', completed_at: new Date(2026, 8, 30, 23, 55).toISOString() }), NOW)).toBe(false);
    expect(isCompletedThisMonth(row({ id: 3, status: 'completed', completed_at: new Date(2025, 9, 10).toISOString() }), NOW)).toBe(false);
    expect(isCompletedThisMonth(row({ id: 4, status: 'completed' }), NOW)).toBe(false);
    expect(isCompletedThisMonth(row({ id: 5, status: 'accepted', completed_at: new Date(2026, 9, 10).toISOString() }), NOW)).toBe(false);
  });

  test('a booking moves Offered -> Won -> Completed and is never counted twice', () => {
    const offered = row({ id: 1, status: 'offered' });
    expect(businessPipeline([offered], [], { now: NOW })).toMatchObject({ offered: 1, won: 0, completed: 0 });
    const won = { ...offered, status: 'accepted' };
    expect(businessPipeline([won], [], { now: NOW })).toMatchObject({ offered: 0, won: 1, completed: 0 });
    const redeemed = { ...won, status: 'completed', completed_at: new Date(2026, 9, 14).toISOString() };
    expect(businessPipeline([redeemed], [], { now: NOW })).toMatchObject({ new: 0, offered: 0, won: 0, completed: 1 });
  });

  test('every row lands in at most one stage', () => {
    const rows = [
      row({ id: 1 }), row({ id: 2, status: 'offered' }), row({ id: 3, status: 'accepted' }),
      row({ id: 4, status: 'completed', completed_at: new Date(2026, 9, 2).toISOString() }),
      row({ id: 5, status: 'declined' }), row({ id: 6, status: 'completed', completed_at: new Date(2026, 5, 2).toISOString() }),
    ];
    for (const r of rows) {
      const hits = [isPipelineNew(r, new Set(), NOW), isPipelineOffered(r, NOW), isPipelineWon(r), isCompletedThisMonth(r, NOW)].filter(Boolean);
      expect(hits.length).toBeLessThanOrEqual(1);
    }
    expect(businessPipeline(rows, [], { now: NOW })).toEqual({ new: 1, reviewing: 0, offered: 1, won: 1, completed: 1 });
  });

  test('the Home brief reads the same New and Offered rules (one definition)', () => {
    const rows = [row({ id: 1 }), row({ id: 2, status: 'offered', business_requests: { status: 'fulfilled' } }), row({ id: 3, status: 'offered' })];
    const subs = [{ request_id: 'r1', status: 'reviewing' }];
    const g = dashboardGlance(rows, null, NOW, subs);
    const p = businessPipeline(rows, subs, { now: NOW });
    expect(g.today.find((x) => x.key === 'new').count).toBe(p.new);
    expect(g.upcoming.find((x) => x.key === 'awaiting').count).toBe(p.offered);
    const glanceSrc = fs.readFileSync(path.join(__dirname, 'dashboardGlance.js'), 'utf8');
    expect(glanceSrc).toMatch(/isPipelineNew\(o, reviewing, now\)/);
    expect(glanceSrc).toMatch(/isPipelineOffered\(o, now\)/);
  });

  test('the dashboard draws the strip from the helper, only after loading, and Upcoming Visits reads Won', () => {
    const dash = fs.readFileSync(path.join(__dirname, '..', 'screens/BusinessDashboardScreen.js'), 'utf8');
    expect(dash).toMatch(/opportunitiesLoaded === true && \(\(\) => \{\s*const pipeline = businessPipeline\(opportunities, offerSubmissions, \{ noShowIds \}\)/);
    expect(dash).toMatch(/dashboardGlance\(opportunities, estimatedOwed, new Date\(\), offerSubmissions\)/);
    expect(dash).not.toMatch(/o\.status === 'accepted' && !noShowIds\.has/);
  });

  test('wording in all 11 languages', () => {
    expect(translate('en', 'ui.bizDash2.pipeline.newSub', { count: 3 })).toBe('3 new opportunities');
    expect(translate('en', 'ui.bizDash2.pipeline.offeredSub', { count: 1 })).toBe('1 offer awaiting acceptance');
    for (const lang of ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']) {
      for (const s of PIPELINE_STAGES) {
        expect(translate(lang, `ui.bizDash2.pipeline.${s}`)).not.toMatch(/^ui\./);
        expect(translate(lang, `ui.bizDash2.pipeline.${s}Sub`, { count: 2 })).toMatch(/2/);
      }
    }
  });
});

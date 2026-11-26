import { reportUpdateItems, REPORT_UPDATE_TITLE_KEYS } from './reportUpdates';
import fs from 'fs';
import path from 'path';

describe('reporter feedback rows (20270397)', () => {
  test('open report = Report received, dated when filed', () => {
    expect(reportUpdateItems([{ report_id: 'r1', received_at: '2026-11-07T10:00:00Z', completed_at: null }])).toEqual([
      { type: 'report_update', key: 'report-r1', timestamp: '2026-11-07T10:00:00Z', raw: { state: 'received', titleKey: 'ui.activity.reportReceived' } },
    ]);
  });
  test('resolved report = Review completed, dated when completed; one row per report', () => {
    const items = reportUpdateItems([{ report_id: 'r2', received_at: '2026-11-01T10:00:00Z', completed_at: '2026-11-03T09:00:00Z' }]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'report-r2', timestamp: '2026-11-03T09:00:00Z', raw: { state: 'completed', titleKey: 'ui.activity.reviewCompleted' } });
  });
  test('nothing beyond ids + times is carried (no outcome, reason, account, evidence)', () => {
    const [item] = reportUpdateItems([{ report_id: 'r3', received_at: '2026-11-01T10:00:00Z', completed_at: '2026-11-02T10:00:00Z',
      outcome: 'action_taken', reason: 'harassment', reported_id: 'x', content_excerpt: 'secret' }]);
    expect(Object.keys(item.raw).sort()).toEqual(['state', 'titleKey']);
    expect(JSON.stringify(item)).not.toMatch(/action_taken|harassment|secret|"x"/);
  });
  test('bad input = no rows', () => {
    expect(reportUpdateItems(null)).toEqual([]);
    expect(reportUpdateItems([{ report_id: null, received_at: 'x' }, { report_id: 'a' }])).toEqual([]);
  });
  test('both strings exist in every language, and Activity reads only this rule', () => {
    const activity = require('../i18n/ui/activity').default;
    for (const lang of Object.keys(activity)) {
      for (const key of Object.values(REPORT_UPDATE_TITLE_KEYS)) expect([lang, key, typeof activity[lang][key.split('.').pop()]]).toEqual([lang, key, 'string']);
    }
    expect(activity.en.reportReceived).toBe('Report received');
    expect(activity.en.reviewCompleted).toBe('Review completed. Thank you for helping keep Nearby safe.');
    const screen = fs.readFileSync(path.join(__dirname, '../screens/ActivityScreen.js'), 'utf8');
    expect(screen).toMatch(/getMyReportUpdates\(\)/);
    expect(screen).not.toMatch(/get_my_report_updates|from\('reports'\)/);
  });
  test('the report sheet confirms with "Report received"', () => {
    const reportBlock = require('../i18n/ui/reportBlock').default;
    expect(reportBlock.en.reportSubmitted).toBe('Report received');
  });
});

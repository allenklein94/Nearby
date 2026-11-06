const fs = require('fs');
const path = require('path');
const { REMOVAL_REASON_MIN, REMOVAL_REASON_MAX, canRemoveReportedObject, removalReasonReady, removeActionLabel, reportObjectIds, reportObjectStatus } = require('./reportObjects');

const ROOT = path.join(__dirname, '../..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270393_admin_content_removal.sql'), 'utf8');
const SCREEN = fs.readFileSync(path.join(ROOT, 'src/screens/AdminReportsScreen.js'), 'utf8');

describe('removing a reported gathering or community (20270393)', () => {
  test('only gathering and community reports are looked up', () => {
    expect(reportObjectIds([{ id: 'a', content_type: 'gathering' }, { id: 'b', content_type: 'community' }, { id: 'c', content_type: 'story' }, { id: 'd' }])).toEqual(['a', 'b']);
    expect(reportObjectIds(null)).toEqual([]);
  });

  test('Remove is offered only while the report is open and the server says the object is there', () => {
    const open = { content_type: 'gathering', resolved: false };
    expect(canRemoveReportedObject(open, { state: 'live' })).toBe(true);
    expect(canRemoveReportedObject({ ...open, content_type: 'community' }, { state: 'live' })).toBe(true);
    expect(canRemoveReportedObject(open, { state: 'removed' })).toBe(false);
    expect(canRemoveReportedObject(open, { state: 'gone' })).toBe(false);
    expect(canRemoveReportedObject(open, undefined)).toBe(false); // an older database: nothing offered
    expect(canRemoveReportedObject({ ...open, resolved: true }, { state: 'live' })).toBe(false);
    expect(canRemoveReportedObject({ content_type: 'story' }, { state: 'live' })).toBe(false);
  });

  test('the button names what it removes', () => {
    expect(removeActionLabel('gathering')).toBe('Remove Gathering');
    expect(removeActionLabel('community')).toBe('Remove Community');
  });

  test('a reason is required, with the server\'s own limits, not counting spaces', () => {
    expect(removalReasonReady('')).toBe(false);
    expect(removalReasonReady(null)).toBe(false);
    expect(removalReasonReady(`${'x'.repeat(REMOVAL_REASON_MIN - 1)}      `)).toBe(false);
    expect(removalReasonReady('x'.repeat(REMOVAL_REASON_MIN))).toBe(true);
    expect(removalReasonReady('x'.repeat(REMOVAL_REASON_MAX + 1))).toBe(false);
    expect(MIGRATION).toContain(`length(v_reason) not between ${REMOVAL_REASON_MIN} and ${REMOVAL_REASON_MAX}`);
  });

  test('the status says what the server recorded, and nothing while the object is live', () => {
    expect(reportObjectStatus({ state: 'live' })).toBeNull();
    expect(reportObjectStatus(undefined)).toBeNull();
    expect(reportObjectStatus({ state: 'gone' })).toBe('No longer on Nearby');
    expect(reportObjectStatus({ state: 'removed', removed_by_name: 'Sam', reason: 'Fraud event' })).toBe('Removed by Sam: Fraud event');
  });

  test('the screen goes through the rule and the server function, with no direct delete', () => {
    expect(SCREEN).toContain("supabase.rpc('admin_remove_reported_content'");
    expect(SCREEN).toContain('canRemoveReportedObject(item, objects[item.id])');
    expect(SCREEN).not.toMatch(/from\('(gatherings|communities)'\)/);
  });

  test('server: admins only, execute for signed-in callers only, the helpers closed to every client', () => {
    expect(MIGRATION).toMatch(/not check_is_admin\(v_admin\)[\s\S]*?hint = 'admin_only'/);
    expect(MIGRATION).toContain('revoke all on function public.admin_remove_reported_content(uuid, text) from public, anon;');
    expect(MIGRATION).toContain('revoke all on table private.content_removals from public, anon, authenticated;');
    ['private.content_removal_close_links(text, uuid, boolean)', 'private.content_remove_gathering(public.gatherings, uuid, uuid, text)',
      'private.content_remove_community(public.communities, uuid, uuid, text)'].forEach((f) => {
      expect(MIGRATION).toContain(`revoke all on function ${f} from public, anon, authenticated;`);
    });
  });

  test('server: no location in the snapshot and no title in a removal push (locked rules)', () => {
    const snapshot = MIGRATION.slice(MIGRATION.indexOf('create function private.content_remove_gathering'), MIGRATION.indexOf('create function private.content_remove_community'));
    expect(snapshot).not.toMatch(/precise_l|g\.area|wide_area|to_jsonb\(g\)/);
    const pushes = MIGRATION.match(/_send_push\([^;]*;/g).filter((p) => /removed/i.test(p));
    expect(pushes.length).toBeGreaterThan(5);
    pushes.forEach((p) => expect(p).not.toMatch(/\.title|\.name|v_title|v_name/));
  });
});

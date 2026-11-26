// Story file deletion (20270391): the app's notice, and the rules in the migration a journey can't see the absence of.
const fs = require('fs');
const path = require('path');
const { storyFileCleanupNotice } = require('./storyFileCleanup');

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270391_media_reports.sql'), 'utf8');
const fn = (name) => {
  const start = sql.indexOf(`create or replace function ${name}(`);
  return sql.slice(start, sql.indexOf('$function$;', start));
};

describe('notice', () => {
  test('nothing failing shows nothing', () => {
    [null, undefined, {}, { failing: 0, kinds: {} }].forEach((s) => expect(storyFileCleanupNotice(s)).toBeNull());
  });
  test('says how many and why, most common first, and offers retry only for given-up files', () => {
    const n = storyFileCleanupNotice({ failing: 3, gave_up: 1, kinds: { server: 1, refused: 2 } });
    expect(n).toEqual({ title: "3 removed photo files couldn't be deleted", reasons: 'Storage refused the key · Storage is returning errors', canRetry: true });
    expect(storyFileCleanupNotice({ failing: 1, gave_up: 0, kinds: { timeout: 1 } })).toEqual({ title: "1 removed photo file couldn't be deleted", reasons: 'Storage is timing out', canRetry: false });
  });
  test('an unknown kind still reads as a sentence, never a raw key', () => {
    expect(storyFileCleanupNotice({ failing: 1, kinds: { new_thing: 1 } }).reasons).toBe('Storage gave an unexpected answer');
  });
});

describe('migration', () => {
  test('a file leaves the queue in exactly one place, and only with a success or not-found answer and no object row', () => {
    expect(sql.match(/delete from private\.story_file_cleanup\b(?!_)/g)).toHaveLength(1);
    const read = fn('private._story_file_read_responses');
    expect(read).toMatch(/if \(v_code between 200 and 299 or v_code = 404\)\s+and not exists \(select 1 from storage\.objects o where o\.bucket_id = 'stories' and o\.name = r\.media_path\) then\s+delete from private\.story_file_cleanup where media_path = r\.media_path;/);
  });
  test('a send never trusts the list it read: lock, then a fresh hold and row check, then the DELETE', () => {
    const send = fn('private._story_file_send');
    const [lock, recheck, call] = ['for update skip locked', 'continue when exists', 'net.http_delete('].map((t) => send.indexOf(t));
    expect(lock).toBeGreaterThan(-1);
    expect(recheck).toBeGreaterThan(lock);
    expect(call).toBeGreaterThan(recheck);
    expect(send).toMatch(/report_media_evidence e where e\.media_path = v_path and e\.released_at is null/);
  });
  test('a path reaches the URL only encoded, and an unsafe one never', () => {
    const send = fn('private._story_file_send');
    expect(send).toMatch(/\|\| private\._storage_url_path\(v_path\)/);
    expect(send).not.toMatch(/\|\| v_path/);
    expect(send.indexOf('_story_file_path_unsafe')).toBeLessThan(send.indexOf('net.http_delete('));
  });
  test('a cleanup error can\'t stop Stories expiring: expiry runs first, outside the guarded block', () => {
    const job = fn('public.delete_expired_stories');
    expect(job.indexOf('delete from stories where expires_at')).toBeLessThan(job.indexOf('begin\n    if pg_try_advisory_xact_lock'));
    expect(job).toMatch(/exception when others then\s+insert into private\.story_file_cleanup_log/);
  });
  test('the admin alert carries counts only, and reuses the report push (no new push type, no send-push redeploy)', () => {
    const alert = fn('private._story_file_alert');
    expect(alert).toMatch(/jsonb_build_object\('type', 'admin_report_received', 'kind', 'story_file_cleanup'\)/);
    expect(alert).not.toMatch(/media_path/);
    expect(fn('public.admin_story_file_cleanup_status')).not.toMatch(/'media_path'|'paths?'/);
  });
});

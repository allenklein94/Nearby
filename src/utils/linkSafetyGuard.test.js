// Link destination safety (20270396): the static rules a journey or the Deno tests can't see.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MIGRATION = read('supabase/migrations/20270396_link_safety.sql');
const ROLLBACK = read('scripts/rollback/20270396_link_safety.rollback.sql');
const EDGE = read('supabase/functions/screen-user-content/index.ts');
const LIB = read('supabase/functions/_shared/linkSafety.ts');
const HARNESS = read('src/journeys/journeyHarness.js');

describe('link destination safety (20270396)', () => {
  test('the edge function checks exactly the links the database enforces (one detector)', () => {
    expect(EDGE).toContain("admin.rpc('ugc_links_for_check'");
    expect(EDGE).toMatch(/checkLinks\(links, linkDeps/); // the library is handed the database's list, never finds links itself
    expect(MIGRATION).toMatch(/create function public\.ugc_links_for_check[\s\S]*?select private\.ugc_links\(p_text\)/);
  });

  test('every new function is server-only; the tables have no client access', () => {
    for (const sig of ['public.ugc_links_for_check(text)', 'public.claim_link_checks(uuid, integer)',
      'public.find_ugc_link_screening(uuid, text, boolean)']) {
      expect(MIGRATION).toContain(`revoke all on function ${sig} from public, anon, authenticated;`);
      expect(MIGRATION).toContain(`grant execute on function ${sig} to service_role;`);
    }
    expect(MIGRATION).toMatch(/revoke all on function public\.record_ugc_link_screening\([^)]*\)\s+from public, anon, authenticated;/);
    expect(MIGRATION).toMatch(/grant execute on function public\.record_ugc_link_screening\([^)]*\)\s+to service_role;/);
    expect(MIGRATION).toContain('revoke all on table private.link_check_usage from public, anon, authenticated;');
    expect(MIGRATION).not.toMatch(/grant [^;]*to (anon|authenticated)/);
  });

  test('fail closed: Web Risk down / unverifiable / too many links never record a result', () => {
    const linked = EDGE.slice(EDGE.indexOf('async function screenLinkedText'), EDGE.indexOf('async function screenChatBatch'));
    const unavailableAt = linked.indexOf("check.verdict === 'unavailable'");
    const unverifiableAt = linked.indexOf("check.verdict === 'unverifiable'");
    const firstRecord = linked.indexOf("record_ugc_link_screening");
    expect(unavailableAt).toBeGreaterThan(0);
    expect(unverifiableAt).toBeGreaterThan(unavailableAt);
    expect(firstRecord).toBeGreaterThan(unverifiableAt);
    expect(LIB).toMatch(/if \(!deps\.webRiskKey\) return 'unavailable'/);
  });

  test('no URL is logged or stored', () => {
    for (const line of EDGE.split('\n').filter((l) => l.includes('console.'))) {
      expect(line.replace(/linkCount: links\.length/g, '')).not.toMatch(/\blinks\b|\burl\b|\bhref\b|item\.text/);
    }
    expect(EDGE).toMatch(/linkCount: links\.length/);
    expect(LIB).not.toMatch(/console\./);
    expect(MIGRATION).not.toMatch(/add column [a-z_]*url/i);
  });

  test('only the commercial Web Risk API is called (Safe Browsing v4 is non-commercial only)', () => {
    expect(LIB).toContain('https://webrisk.googleapis.com/v1/uris:search');
    expect(LIB + EDGE).not.toContain('safebrowsing.googleapis.com');
    expect(EDGE).toContain("Deno.env.get('GOOGLE_WEB_RISK_API_KEY')");
  });

  test('the journey harness stands in for the link lookup like 0373\'s; the rollback undoes every object', () => {
    expect(HARNESS).toContain('private.ugc_link_screening_lookup(uuid,text,boolean)');
    for (const obj of ['purge_link_check_usage', 'find_ugc_link_screening', 'ugc_link_screening_lookup', 'record_ugc_link_screening',
      'claim_link_checks', 'link_check_usage', 'ugc_links_for_check', 'private.ugc_links(text)', 'link_threats', 'link_count', 'link_check']) {
      expect(ROLLBACK).toContain(obj);
    }
    expect(ROLLBACK).toContain("cron.unschedule('purge-link-check-usage')");
  });
});

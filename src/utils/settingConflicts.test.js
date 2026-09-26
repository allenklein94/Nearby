// Item 86, final contract (migration 20270226): exact wording, availability-posting bundles, one structured refusal, inline display.
import fs from 'fs';
import path from 'path';
import {
  applyRecheck, clearConflict, conflictMessages, errorWithConflicts, hasPending, reportConflict, settingConflictsOf, shownValue,
} from './settingConflicts';
import { serviceError, isServiceFailure } from './recoverableError';

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MIG = read('supabase/migrations/20270226_setting_conflicts_structured.sql');
const LIVE = read('scripts/live-verify/business-restriction-contradictions.sql');
const line = (r, s) => `${r} conflicts with ${s}. Remove one of these settings to continue.`;

describe('the server owns the rule and the exact words (20270226)', () => {
  it('one message builder with the owner\'s exact template', () => {
    expect(MIG).toContain("format('%s conflicts with %s. Remove one of these settings to continue.', restriction, setting)");
    expect((MIG.match(/conflicts with %s/g) ?? []).length).toBe(1);
  });
  it('every owner-listed setting is named exactly as the owner wrote it, never a field name', () => {
    for (const label of ['Family-friendly', 'Kids menu', 'Family seating', 'Stroller friendly', "'Suited ages'", "'Family'", "'Group/Family'",
      "'wanting more families'", "'Family Signature Experience'", "'Family Gathering'", "'Outdoor dining'", "'the outdoor area size'"]) {
      expect([label, MIG.includes(label)]).toEqual([label, true]);
    }
    expect(MIG).not.toMatch(/\(groups you take\)|\(occasions you offer\)|\(what you want more of\)/);
  });
  it('No children names itself; 21+ alone says 21+ only; 21+ with No children is never a conflict', () => {
    expect(MIG).toMatch(/'no_children' = any[\s\S]{0,60}then 'No children'[\s\S]{0,120}'adults_21_plus' = any[\s\S]{0,60}then '21\+ only'/);
    expect(LIVE).toMatch(/\('21\+ \+ No children',[^\n]*'ALLOWED'\)/);
  });
  it('availability bundles: only the structured Family Gathering value of a LIVE posting, both save directions', () => {
    expect(MIG).toMatch(/kind in \('package', 'availability'\) and occasion = 'family_gathering' then 'Family Gathering'/);
    expect(MIG).toMatch(/a\.status = 'active' and a\.ends_at > now\(\)/);
    expect(MIG).toMatch(/create trigger check_availability_vs_no_children\s+before insert or update of bundle_occasion, partner_id, status, ends_at on public\.business_availability/);
    // never free text, photos or categories
    const label = MIG.match(/function public\._family_offering_label[\s\S]*?\$\$;/)[0];
    expect(label).not.toMatch(/description|included_items|media|category|title ~|title ilike/);
    for (const c of ['No children + Family Gathering posting', '21+ + Family Gathering posting', 'No children + ended Family Gathering posting',
      'No children + Date night posting', 'No children + posting with no bundle', 'No pets + Family Gathering posting']) {
      expect([c, LIVE.includes(`('${c}',`)]).toEqual([c, true]);
    }
    expect(LIVE).toMatch(/rpc post_business_availability Family Gathering with No children: REFUSED/);
    expect(LIVE).toMatch(/rpc set No children with a live Family Gathering posting: REFUSED/);
  });
  it('category-only family businesses stay allowed; indoor rules and the hidden leftover size are unchanged', () => {
    expect(MIG).not.toMatch(/bp\.(category|subcategory|categories)\b/);
    expect(MIG).toMatch(/bp\.weather_setting = 'indoor' and 'outdoor_seating' = any[\s\S]{0,200}bp\.outdoor_capacity is not null/);
    expect(LIVE).toMatch(/\('Indoor only \+ stale hidden outdoor size',[^\n]*'ALLOWED'\)/);
    expect(LIVE).toMatch(/\('No children \+ family category tag',[^\n]*'ALLOWED'\)/);
  });
  it('one structured refusal carrying every conflict: newline message, JSON detail, hint', () => {
    expect(MIG).toMatch(/raise exception using message = array_to_string\(v, E'\\n'\), detail = to_jsonb\(v\)::text, hint = 'setting_conflict'/);
    expect(MIG).toMatch(/perform public\._raise_setting_conflicts\(public\._business_profile_conflicts\(new\)\)/);
    expect(LIVE).toMatch(/multi-conflict save: every line once/);
  });
  it('the check-only call runs the real trigger in a rolled-back subtransaction (no second copy of the rule)', () => {
    const fn = MIG.match(/function public\.check_business_setting_conflicts[\s\S]*?\$\$;/)[0];
    expect(fn).toMatch(/update brand_partners set/);
    expect(fn).toMatch(/errcode = 'NBDRY'/);
    expect(fn).toMatch(/v_hint = 'setting_conflict'/);
    expect(fn).toMatch(/managed_partner_id = partner_id_param/);
    expect(MIG).toMatch(/revoke all on function public\.check_business_setting_conflicts\(uuid, text, jsonb\) from public, anon;/);
  });
  it('the screening function answers a conflict before AI screening, for profile, experience and availability', () => {
    const fn = read('supabase/functions/screen-business-content/index.ts');
    for (const kind of ['profile', 'experience', 'availability']) {
      expect([kind, new RegExp(`preCheckConflicts\\(supabaseAsUser, partnerId, '${kind}'`).test(fn)]).toEqual([kind, true]);
    }
    const av = fn.slice(fn.indexOf("if (targetType === 'availability')"));
    expect(av.indexOf("preCheckConflicts(supabaseAsUser, partnerId, 'availability'")).toBeLessThan(av.indexOf('classifyContent('));
    expect(av).toMatch(/low-tier availability write failed', writeError\);\s*return writeRefusal\(writeError\)/);
  });
});

describe('reading the refusal (client knows no rule)', () => {
  const lines = [line('No children', 'Family-friendly'), line('No children', 'Kids menu')];
  it('from a Supabase RPC error (hint + JSON details)', () => {
    expect(settingConflictsOf({ message: lines.join('\n'), hint: 'setting_conflict', details: JSON.stringify(lines), code: 'P0001' })).toEqual(lines);
  });
  it('from the screening function (400 {code, conflicts}) through serviceError', () => {
    const e = serviceError({ status: 400 }, { error: lines.join('\n'), code: 'setting_conflict', conflicts: lines }, 'x');
    expect(settingConflictsOf(e)).toEqual(lines);
    expect(isServiceFailure(e)).toBe(false);
  });
  it('through a service that rewraps the error (occasion packages)', () => {
    const e = errorWithConflicts({ message: lines[0], hint: 'setting_conflict', details: JSON.stringify([lines[0]]) });
    expect(settingConflictsOf(e)).toEqual([lines[0]]);
    expect(read('src/services/occasionPackages.js')).toMatch(/throw errorWithConflicts\(error\)/);
  });
  it('duplicates collapse', () => {
    expect(settingConflictsOf({ conflicts: [lines[0], lines[0], lines[1]] })).toEqual(lines);
  });
  it('generic server, database and network failures are NOT conflicts (they keep the existing error behavior)', () => {
    expect(settingConflictsOf(null)).toBeNull();
    expect(settingConflictsOf(new Error('Network request failed'))).toBeNull();
    expect(settingConflictsOf({ message: 'boom', code: '23514' })).toBeNull();
    expect(settingConflictsOf({ message: 'x', hint: 'something_else', details: '["a"]' })).toBeNull();
    expect(settingConflictsOf(serviceError({ status: 503 }, { error: 'x', code: 'screening_unavailable' }, 'x'))).toBeNull();
    expect(settingConflictsOf({ hint: 'setting_conflict', details: 'not json' })).toBeNull();
    expect(settingConflictsOf({ conflicts: [] })).toBeNull();
  });
});

describe('display lifecycle', () => {
  const m = [line('No children', 'Family-friendly')];
  const check = { kind: 'profile', patch: { not_accommodated: ['no_children'] } };
  it('a refused per-tap choice stays visible but unsaved; the saved value is untouched', () => {
    const e = reportConflict({}, 'not_accommodated', m, { pending: ['no_children'], check });
    expect(conflictMessages(e, 'not_accommodated')).toEqual(m);
    expect(shownValue(e, 'not_accommodated', [])).toEqual(['no_children']);
    expect(hasPending(e, 'not_accommodated')).toBe(true);
  });
  it('resolution clears the message; the unsaved choice waits for the owner\'s Save', () => {
    let e = reportConflict({}, 'not_accommodated', m, { pending: ['no_children'], check });
    e = applyRecheck(e, 'not_accommodated', [], check);
    expect(conflictMessages(e, 'not_accommodated')).toEqual([]);
    expect(shownValue(e, 'not_accommodated', [])).toEqual(['no_children']);
    e = clearConflict(e, 'not_accommodated'); // a successful save
    expect(e).toEqual({});
  });
  it('a form surface (no pending) disappears on resolution', () => {
    let e = reportConflict({}, 'package', [line('No children', 'Family Gathering')], { check: { kind: 'package', patch: { occasion_type: 'family_gathering' } } });
    e = applyRecheck(e, 'package', [], { kind: 'package', patch: { occasion_type: 'birthday' } });
    expect(e.package).toBeUndefined();
  });
  it('several distinct conflicts are all shown; a recheck can shrink the list', () => {
    const two = [line('No children', 'Family-friendly'), line('No children', 'Kids menu')];
    let e = reportConflict({}, 'profile_edit', two, { check });
    expect(conflictMessages(e, 'profile_edit')).toEqual(two);
    e = applyRecheck(e, 'profile_edit', [two[1]]);
    expect(conflictMessages(e, 'profile_edit')).toEqual([two[1]]);
  });
  it('no surface is touched by another', () => {
    const e = reportConflict({}, 'a', m);
    expect(applyRecheck(e, 'b', [])).toBe(e);
    expect(clearConflict(e, 'b')).toBe(e);
  });
});

describe('the dashboard shows conflicts inline, never as an alert, and decides nothing', () => {
  const dash = read('src/screens/BusinessDashboardScreen.js');
  const card = read('src/components/TellNearbyBusinessCard.js');
  it('every save path hands a conflict to the inline state before any alert', () => {
    for (const surface of ["'profile_edit'", "'priority'", "'accommodations'", "'experience'", "'package'", "'availability'", '`experience_suggestion:']) {
      expect([surface, new RegExp(`settingConflicts\\.report\\(${surface.replace(/[.*+?^${}()|[\]\\`]/g, '\\$&')}`).test(dash)]).toEqual([surface, true]);
    }
    expect(dash).toMatch(/if \(!settingConflicts\.report\(surface, e, \{ pending: next, check: \{ kind: 'profile', patch: patch\(next\) \} \}\)\) \{\s*presentRecoverableError/);
    for (const s of ['not_accommodated', 'weather_setting', 'offered_occasions', 'suited_ages']) {
      expect([s, dash.includes(`savePerTapSetting('${s}'`)]).toEqual([s, true]);
      expect([s, dash.includes(`conflictMessages(settingConflicts.entries, '${s}')`)]).toEqual([s, true]);
    }
    expect(card).toMatch(/conflicts\.report\('tell'/);
  });
  it('a refused per-tap choice is not persisted: the saved value is put back, the choice lives only in the notice state', () => {
    const helper = dash.match(/async function savePerTapSetting[\s\S]*?\n  }\n/)[0];
    expect(helper).toMatch(/catch \(e\) \{\s*setSelectedPartner\(\(prev\) => \(\{ \.\.\.prev, \.\.\.field\(saved\) \}\)\);/);
  });
  it('multi-save forms ask the server before saving, so nothing is half-applied', () => {
    expect(dash).toMatch(/const lines = await checkBusinessSettingConflicts\(selectedPartner\.id, priorityCheck\.kind, priorityCheck\.patch\);[\s\S]{0,200}return;[\s\S]{0,80}await Promise\.all\(/);
    expect(card).toMatch(/const lines = await checkBusinessSettingConflicts\([\s\S]{0,200}return;[\s\S]{0,40}const applied = \{\};/);
  });
  it('no client copy of the rule or the wording', () => {
    for (const src of [dash, card, read('src/utils/settingConflicts.js'), read('src/hooks/useSettingConflicts.js'), read('src/components/SettingConflictNotice.js')]) {
      expect(src).not.toMatch(/conflicts with [A-Z]|Remove one of these settings/);
      expect(src).not.toMatch(/family_gathering[^\n]*no_children|no_children[^\n]*family_gathering|kid_friendly[^\n]*no_children/);
    }
  });
  it('no new screen, modal or conflict center', () => {
    expect(read('src/components/SettingConflictNotice.js')).not.toMatch(/Modal|navigation|Alert/);
    expect(dash).not.toMatch(/ConflictCenter|conflictModal/i);
  });
});

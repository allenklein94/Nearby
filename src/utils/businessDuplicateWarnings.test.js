// 20270414 (owner idea 36): duplicate business details / identical business images for admin review only.
import fs from 'fs';
import path from 'path';
import {
  duplicateWarningLine, warningsFor, activeWarnings, approvalNeedsConfirm, mediaMatchPairs, dismissArgs,
} from './businessDuplicateWarnings';
import { screenOfferMedia } from '../../supabase/functions/_shared/offerMediaScreening';

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const row = (o) => ({ subject_type: 'application', subject_id: 'r1', match_kind: 'phone', other_request_id: 'r2', other_partner_id: null,
  other_name: "Joe's Cafe", other_status: 'approved', same_account: false, dismissed: false, ...o });

describe('warning wording', () => {
  test('names the field, the other business and what it is; never accuses', () => {
    expect(duplicateWarningLine(row())).toBe('Same phone number as "Joe\'s Cafe" (approved business).');
    expect(duplicateWarningLine(row({ match_kind: 'email', other_status: 'pending' }))).toBe('Same email address as "Joe\'s Cafe" (pending application).');
    expect(duplicateWarningLine(row({ match_kind: 'website', same_account: true, other_status: 'denied' })))
      .toBe('Same website as "Joe\'s Cafe" (declined application, sent from this same account).');
    expect(duplicateWarningLine(row({ subject_type: 'business', match_kind: 'media', subject_media: 'logo,offer_photo', other_media: 'logo', other_status: 'active' })))
      .toBe('Its logo and offer photo is the exact same image as the logo of "Joe\'s Cafe" (business).');
    for (const r of [row(), row({ match_kind: 'media', subject_media: 'logo', other_media: 'logo' })]) {
      expect(duplicateWarningLine(r)).not.toMatch(/fraud|fake|scam|suspicious|reject|block/i);
    }
  });
  test('an unknown kind renders nothing (and is never listed)', () => {
    expect(duplicateWarningLine(row({ match_kind: 'address' }))).toBe('');
    expect(warningsFor([row({ match_kind: 'address' })], 'application', 'r1')).toEqual([]);
  });
});

describe('what the admin is asked', () => {
  const rows = [row({ dismissed: true, match_kind: 'email' }), row(), row({ subject_id: 'r9' })];
  test('a card lists its own rows, undismissed first', () => {
    expect(warningsFor(rows, 'application', 'r1').map((r) => r.dismissed)).toEqual([false, true]);
    expect(activeWarnings(rows, 'application', 'r1')).toHaveLength(1);
  });
  test('approve asks first only while an undismissed match exists; it is never refused', () => {
    expect(approvalNeedsConfirm(rows, 'r1')).toBe(true);
    expect(approvalNeedsConfirm([row({ dismissed: true })], 'r1')).toBe(false);
    expect(approvalNeedsConfirm(null, 'r1')).toBe(false);
  });
  test('an image pair (both directions from the server) is listed once', () => {
    const a = row({ subject_type: 'business', subject_id: 'p1', match_kind: 'media', other_partner_id: 'p2', other_request_id: null });
    const b = { ...a, subject_id: 'p2', other_partner_id: 'p1' };
    expect(mediaMatchPairs([a, b, row()])).toHaveLength(1);
  });
  test('dismiss sends request ids for contact kinds and business ids for images, reason trimmed', () => {
    expect(dismissArgs(row(), ' same owner ')).toEqual({ p_kind: 'phone', p_subject: 'r1', p_other: 'r2', p_reason: 'same owner' });
    expect(dismissArgs(row({ match_kind: 'media', subject_id: 'p1', other_partner_id: 'p2' }), 'x').p_other).toBe('p2');
  });
});

describe('fingerprints come only from a successful photo screen', () => {
  const P = 'partner-1';
  const deps = (sha) => ({
    storage: { signedUrl: async (p) => `https://x/${p}`, list: async () => ({ size: 10 }) },
    classifyImage: async () => ({ riskTier: 'low', matchedCategories: [], reasoning: 'ok', sha256: sha }),
    worseTier: (a, b) => b, recordVideoCheck: async () => true, fetchFn: async () => ({}),
  });
  test('a photo passes its own SHA-256 through', async () => {
    const r = await screenOfferMedia(deps('f'.repeat(64)), P, `${P}/a.jpg`, 'image', []);
    expect(r.sha256).toBe('f'.repeat(64));
  });
  test("a video's sampled frames are never fingerprinted (video deferred)", async () => {
    const d = deps('e'.repeat(64));
    const r = await screenOfferMedia({ ...d, storage: { ...d.storage, list: async () => ({ size: 10 }) } }, P, `${P}/v.mp4`, 'video', [`${P}/f1.jpg`]);
    expect(r.sha256 ?? null).toBeNull();
  });
  test('a refused screen carries no fingerprint', async () => {
    const d = { ...deps('f'.repeat(64)), classifyImage: async () => ({ error: 'x', service: true }) };
    const r = await screenOfferMedia(d, P, `${P}/a.jpg`, 'image', []);
    expect(r.sha256).toBeUndefined();
  });
  test('the edge function records logo + offer photo hashes best effort, after screening, never on a refusal', () => {
    const fn = read('supabase/functions/screen-business-content/index.ts');
    expect(fn).toMatch(/if \('error' in imageResult\) return json\(\{ error: imageResult\.error \}, 400\);\n\s+await recordMediaFingerprint\(admin, partnerId, 'logo'/);
    expect(fn).toMatch(/!result\.error && !result\.service && result\.sha256/);
    // a recording failure is logged and swallowed: it never changes the screening answer
    const rec = fn.slice(fn.indexOf('async function recordMediaFingerprint'), fn.indexOf('// Combines'));
    expect(rec).toMatch(/try \{/);
    expect(rec).not.toMatch(/return json|throw /);
  });
});

describe('privacy boundary', () => {
  const sql = read('supabase/migrations/20270414_business_duplicate_warnings.sql').replace(/--[^\n]*/g, '');
  test('admin reads and dismissals check the admin first; the recorder is service role only', () => {
    expect(sql).toMatch(/admin_business_duplicate_warnings\(\)[\s\S]*?perform private\.require_admin\(\);/);
    expect(sql).toMatch(/v_admin uuid := private\.require_admin\(\);/);
    expect(sql).toMatch(/revoke all on function public\.record_business_media_fingerprint\(uuid, text, text, text\) from public, anon, authenticated;\ngrant execute on function public\.record_business_media_fingerprint\(uuid, text, text, text\) to service_role;/);
    expect(sql).toMatch(/revoke all on private\.business_media_fingerprints from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke all on private\.business_duplicate_dismissals from public, anon, authenticated;/);
  });
  test('nothing new stores contact details; no customer, profile, chat or story media is read', () => {
    expect(sql).not.toMatch(/create table[^;]*(phone|email|website)/i);
    expect(sql).not.toMatch(/profile_photos|photo_fingerprints|stories|messages|chat/);
  });
  test('only admin code calls the admin functions; nothing in the app calls the recorder', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const files = walk(path.join(root, 'src')).filter((f) => /\.js$/.test(f) && !/\.test\.js$|\.journey\.js$/.test(f));
    const callers = files.filter((f) => /rpc\('admin_(business_duplicate_warnings|dismiss_business_duplicate)'/.test(fs.readFileSync(f, 'utf8')));
    expect(callers.map((f) => path.relative(root, f)).sort()).toEqual(['src/screens/AdminBusinessRequestsScreen.js']);
    expect(files.filter((f) => /rpc\('record_business_media_fingerprint'/.test(fs.readFileSync(f, 'utf8')))).toEqual([]);
  });
  test('approval itself is untouched (no new refusal)', () => {
    expect(sql).not.toMatch(/approve_business_partner_request/);
  });
});

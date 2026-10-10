// Business logos on offer surfaces (owner, 2026-10-10): a small round screened logo beside the business name on the offer
// card, the arrival pill and the owner's customer preview. Businesses can establish their identity without changing the
// customer's ability to compare offers fairly. Approved logos only; no logo = the surface exactly as before.
const fs = require('fs');
const path = require('path');

const mockRpc = jest.fn();
jest.mock('./supabase', () => ({ supabase: { rpc: (...a) => mockRpc(...a) } }));

import { getScreenedLogos, clearScreenedLogoCache } from './businessLogos';
import { logoMapFromRows, logoFor, pillLogoPartnerId } from '../utils/businessLogo';

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const LOGO = 'https://cdn.example.com/coastal.png';

beforeEach(() => { mockRpc.mockReset(); clearScreenedLogoCache(); });

describe('approved logos', () => {
  test('a logo the server returns as screened is drawn for that business', async () => {
    mockRpc.mockResolvedValue({ data: [{ partner_id: 'p1', logo_url: LOGO }], error: null });
    const map = await getScreenedLogos(['p1']);
    expect(mockRpc).toHaveBeenCalledWith('get_screened_business_logos', { partner_ids: ['p1'] });
    expect(logoFor(map, 'p1')).toBe(LOGO);
  });

  test('each business gets only its own logo when several replied', async () => {
    mockRpc.mockResolvedValue({ data: [{ partner_id: 'p1', logo_url: LOGO }], error: null });
    const map = await getScreenedLogos(['p1', 'p2', 'p1']);
    expect(mockRpc.mock.calls[0][1].partner_ids).toEqual(['p1', 'p2']); // deduped
    expect(logoFor(map, 'p1')).toBe(LOGO);
    expect(logoFor(map, 'p2')).toBeNull();
  });

  test('a cached answer is reused for a reload, then asked again after it ages', async () => {
    mockRpc.mockResolvedValue({ data: [{ partner_id: 'p1', logo_url: LOGO }], error: null });
    await getScreenedLogos(['p1'], { now: 0 });
    await getScreenedLogos(['p1'], { now: 60_000 });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    await getScreenedLogos(['p1'], { now: 10 * 60_000 });
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});

describe('missing logos', () => {
  test('a business with no logo (or one the server did not return) gets none', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const map = await getScreenedLogos(['p1']);
    expect(logoFor(map, 'p1')).toBeNull();
  });

  test('no partner id or no ids asks nothing and draws nothing', async () => {
    expect(await getScreenedLogos([])).toEqual({});
    expect(await getScreenedLogos([null, undefined, ''])).toEqual({});
    expect(mockRpc).not.toHaveBeenCalled();
    expect(logoFor({}, null)).toBeNull();
    expect(logoFor(null, 'p1')).toBeNull();
  });

  test('malformed rows are dropped, never guessed', () => {
    expect(logoMapFromRows([
      { partner_id: 'p1', logo_url: 'javascript:alert(1)' },
      { partner_id: 'p2', logo_url: null },
      { partner_id: null, logo_url: LOGO },
      { partner_id: 'p3', logo_url: ' https://x.example/l.png ' },
    ])).toEqual({ p3: 'https://x.example/l.png' });
    expect(logoMapFromRows(null)).toEqual({});
  });

  test('the mark renders nothing without a logo or after the image fails: no placeholder, no initials', () => {
    const src = read('src/components/BusinessLogoMark.js');
    expect(src).toMatch(/if \(!uri \|\| failed\) return null;/);
    expect(src).toMatch(/onError=\{\(\) => setFailed\(true\)\}/);
  });
});

describe('failed or unapproved screening', () => {
  test('a failed lookup shows no logo and is not cached', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(logoFor(await getScreenedLogos(['p1']), 'p1')).toBeNull();
    mockRpc.mockRejectedValueOnce(new Error('offline'));
    expect(logoFor(await getScreenedLogos(['p1']), 'p1')).toBeNull();
    mockRpc.mockResolvedValueOnce({ data: [{ partner_id: 'p1', logo_url: LOGO }], error: null });
    expect(logoFor(await getScreenedLogos(['p1']), 'p1')).toBe(LOGO); // asked again, not stuck on the failure
  });

  const sql = read('supabase/migrations/20270287_screened_business_logos.sql');
  const fn = sql.slice(sql.indexOf('create or replace function'));

  test('the server returns a logo only when its image was classified and the latest such row is approved', () => {
    expect(fn).toMatch(/content_snapshot->>'logoScreened' = 'true'/);
    expect(fn).toMatch(/content_snapshot->>'logoUrl' = bp\.logo_url/);
    expect(fn).toMatch(/order by s\.created_at desc, s\.id desc\s+limit 1/);
    expect(fn).toMatch(/latest\.review_outcome = 'approved'\s+or \(latest\.review_outcome is null and latest\.risk_tier = 'low'\)/);
    // pending (medium/uncertain, no outcome), denied and auto_blocked are never accepted
    expect(fn).not.toMatch(/risk_tier in \('low', 'medium'/);
    expect(fn).not.toMatch(/review_outcome (=|in) .*(denied|auto_blocked)/);
    expect(fn).toMatch(/auth\.uid\(\) is not null/);
    expect(sql).toMatch(/revoke all on function public\.get_screened_business_logos\(uuid\[\]\) from public, anon;/);
  });

  test('the edge function marks a row as logo-screened only when it really ran the image classifier', () => {
    const fnSrc = read('supabase/functions/screen-business-content/index.ts');
    expect(fnSrc).toMatch(/logoScreened: logoChanged,/);
    // an image error returns before any screening row is written
    const i = fnSrc.indexOf('const imageResult = await classifyImage(logoUrl);');
    expect(fnSrc.slice(i, i + 160)).toMatch(/if \('error' in imageResult\) return json/);
  });

  test('offer surfaces never read brand_partners.logo_url directly: only the screened read', () => {
    for (const f of ['src/components/OfferArrivalSignal.js', 'src/services/offerArrivalSource.js', 'src/services/offerArrivals.js', 'src/components/OfferAssembly.js', 'src/components/OfferCustomerBody.js']) {
      expect(read(f)).not.toMatch(/logo_url/);
    }
    const detail = read('src/screens/BusinessRequestDetailScreen.js');
    expect(detail).not.toMatch(/logo_url/);
    expect(detail).toMatch(/getScreenedLogos\(partnerIds\)/);
    const dash = read('src/screens/BusinessDashboardScreen.js');
    expect(dash).toMatch(/<BusinessLogoMark uri=\{previewLogo\} \/>/);
    expect(dash).not.toMatch(/<BusinessLogoMark uri=\{selectedPartner/);
  });
});

describe('the arrival pill', () => {
  const one = { items: [{ partnerId: 'p1', partnerName: 'Coastal Coffee' }] };
  test('shows a logo only when its text names that one business', () => {
    expect(pillLogoPartnerId(one)).toBe('p1');
    expect(pillLogoPartnerId({ ...one, firstEver: true })).toBeNull(); // "A local business just responded..."
    expect(pillLogoPartnerId({ items: [{ partnerId: 'p1' }, { partnerId: 'p2' }] })).toBeNull(); // "2 offers came in"
    expect(pillLogoPartnerId(null)).toBeNull();
  });

  test('the pill carries the replying business id through', () => {
    expect(read('src/services/offerArrivalSource.js')).toMatch(/select\('id, request_id, partner_id,/);
    expect(read('src/services/offerArrivals.js')).toMatch(/partnerId: r\.partner_id \?\? null/);
  });
});

describe('everything else stays the same for every business', () => {
  const touched = ['src/components/BusinessLogoMark.js', 'src/utils/businessLogo.js', 'src/services/businessLogos.js'];
  test('no brand colours, templates or per-business styling come from the business', () => {
    for (const f of touched) {
      const src = read(f).replace(/\/\/.*$/gm, ''); // code only, not comments
      expect(src).not.toMatch(/brand_?colou?r|primaryColor|template/i);
      expect(src).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
  });

  test('the card keeps its wording, button and media: the logo sits inside the business step only', () => {
    const detail = read('src/screens/BusinessRequestDetailScreen.js');
    const step = detail.slice(detail.indexOf('<AssemblyStep step="business">'), detail.indexOf('</AssemblyStep>', detail.indexOf('<AssemblyStep step="business">')));
    expect(step).toMatch(/<BusinessLogoMark uri=\{logoFor\(partnerLogos, o\.partner_id\)\} \/>/);
    expect(detail.match(/<BusinessLogoMark/g).length).toBe(1); // one mark, nowhere else on the card
    expect(read('src/components/OfferCustomerBody.js')).not.toMatch(/BusinessLogoMark/); // media untouched
  });
});

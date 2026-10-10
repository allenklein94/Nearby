// Business creative library + logo upload (owner, 2026-10-10, LOCKED). Pure state rules, the upload/screening calls with
// their network edges mocked, and source guards for the surfaces. The database half (trigger transitions, offer refusal
// of a non-ready creative, logo gate) is scripts/live-verify/creative-library-logo-upload.sql.
const fs = require('fs');
const path = require('path');

const mockPlatform = { OS: 'ios' };
const mockUpload = jest.fn();
const mockFetch = jest.fn();
jest.mock('react-native', () => ({ get Platform() { return mockPlatform; } }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn(async () => 'aGVsbG8=') }));
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn(async (_u, { time }) => ({ uri: `file:///frame-${time}.jpg` })) }), { virtual: true });
jest.mock('../services/userLocation', () => ({ requireUserLocation: jest.fn(), getUserLocation: jest.fn() }));
jest.mock('../services/supabase', () => ({
  functionUrl: (n) => `https://fn/${n}`,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    storage: {
      from: (bucket) => ({
        upload: (...a) => mockUpload(bucket, ...a),
        getPublicUrl: (p) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${p}` } }),
      }),
    },
  },
}));

import { creativeView, pickerCreatives, canRetry, isStalled, anyReviewing, needsChangesReason, isStoredLogoUrl, CREATIVE_STALE_MS } from './creativeLibrary';
import { videoLimitProblem } from './offerMedia';
import { addCreativeToLibrary, retryCreativeCheck, uploadBusinessLogo } from '../services/businessFulfillment';

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const NOW = Date.parse('2026-10-10T12:00:00Z');

beforeEach(() => {
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockFetch.mockReset().mockResolvedValue({ ok: true, status: 202, json: async () => ({ creativeId: 'c1', status: 'reviewing' }) });
  global.fetch = mockFetch;
  mockPlatform.OS = 'ios';
});

describe('the three states', () => {
  test('reviewing, ready and needs changes read as promised', () => {
    expect(creativeView({ status: 'reviewing', screening_id: 's', reviewing_since: new Date(NOW).toISOString() }, NOW)).toMatchObject({ state: 'reviewing', title: 'Reviewing…', actions: [] });
    expect(creativeView({ status: 'ready' }, NOW)).toMatchObject({ state: 'ready', title: 'Ready to use', actions: ['remove'] });
    const nc = creativeView({ status: 'needs_changes', matched_categories: ['weapons'] }, NOW);
    expect(nc).toMatchObject({ state: 'needs_changes', title: 'Needs changes', actions: ['remove'] });
    expect(nc.detail).toMatch(/weapons/);
  });

  test('the reason comes from the plain server message or the fixed categories, never model text', () => {
    expect(needsChangesReason({ problem: 'That video is too large (max 25MB). Try a shorter clip.' })).toMatch(/25MB/);
    expect(needsChangesReason({ matched_categories: ['weapons', 'fraud_scams'], model_reasoning: 'SECRET MODEL TEXT' })).not.toMatch(/SECRET/);
    expect(needsChangesReason({ matched_categories: ['made_up'] })).toMatch(/didn't pass/);
    expect(needsChangesReason({})).toMatch(/didn't pass/);
  });

  test('a check that could not finish offers a retry; a stalled review too, after 3 minutes only', () => {
    expect(canRetry({ status: 'retry' }, NOW)).toBe(true);
    const fresh = { status: 'reviewing', reviewing_since: new Date(NOW - 60_000).toISOString() };
    const stale = { status: 'reviewing', reviewing_since: new Date(NOW - CREATIVE_STALE_MS - 1000).toISOString() };
    expect(isStalled(fresh, NOW)).toBe(false);
    expect(isStalled(stale, NOW)).toBe(true);
    expect(creativeView(stale, NOW).actions).toEqual(['retry', 'remove']);
    // held for the team (has a screening record): never "stalled", it waits for the reviewer
    expect(isStalled({ ...stale, screening_id: 's1' }, NOW)).toBe(false);
  });

  test('the screen keeps looking only while something is reviewing', () => {
    expect(anyReviewing([{ status: 'ready' }, { status: 'needs_changes' }])).toBe(false);
    expect(anyReviewing([{ status: 'ready' }, { status: 'reviewing' }])).toBe(true);
    expect(anyReviewing([{ status: 'reviewing', archived_at: '2026-10-10' }])).toBe(false);
    expect(anyReviewing(null)).toBe(false);
  });
});

describe('picker eligibility', () => {
  test('only ready, non-archived items reach the offer form', () => {
    const items = [
      { id: 'r', status: 'ready' }, { id: 'v', status: 'reviewing' }, { id: 'n', status: 'needs_changes' },
      { id: 't', status: 'retry' }, { id: 'a', status: 'ready', archived_at: '2026-10-09' }, { id: 'x' }, null,
    ];
    expect(pickerCreatives(items).map((c) => c.id)).toEqual(['r']);
    expect(pickerCreatives(undefined)).toEqual([]);
  });

  test('the offer form renders the picker from pickerCreatives, never the raw list', () => {
    const src = read('src/screens/BusinessDashboardScreen.js');
    expect(src).toMatch(/pickerCreatives\(creatives\)\.length > 0 && !offerPickedMediaAsset/);
    expect(src).toMatch(/pickerCreatives\(creatives\)\.map\(\(c\) => \(\s*<CreativeThumb/);
    expect(src).not.toMatch(/\{creatives\.map\(/);
  });

  test('the server attaches a saved creative to an offer only when it is ready', () => {
    const fn = read('supabase/functions/screen-business-content/index.ts');
    expect(fn).toMatch(/from\('business_creatives'\)\.select\('media_path, media_type, poster_path'\)\s*\.eq\('id', creativeId\)\.eq\('partner_id', partnerId\)\.eq\('status', 'ready'\)/);
  });
});

describe('uploads', () => {
  test('a photo is stored under the business folder as creative-* and sent to screening', async () => {
    const r = await addCreativeToLibrary('p1', { type: 'image', uri: 'file:///a.jpg' });
    expect(r).toEqual({ creativeId: 'c1', status: 'reviewing' });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [bucket, p] = mockUpload.mock.calls[0];
    expect(bucket).toBe('business-offer-media');
    expect(p).toMatch(/^p1\/creative-\d+\.jpg$/);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ partnerId: 'p1', targetType: 'creative', mediaType: 'image', framePaths: [] });
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  test('a video uploads up to three frames for screening beside it', async () => {
    await addCreativeToLibrary('p1', { type: 'video', uri: 'file:///v.mov', duration: 20_000 });
    expect(mockUpload).toHaveBeenCalledTimes(4); // video + 3 frames
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.mediaType).toBe('video');
    expect(body.framePaths).toHaveLength(3);
    body.framePaths.forEach((f) => expect(f).toMatch(/^p1\/creative-/));
  });

  test('a video over 30 seconds is refused with the exact message, before anything is uploaded or trimmed', async () => {
    const MSG = 'Videos can be up to 30 seconds. Trim it on your phone and try again.';
    expect(videoLimitProblem({ type: 'video', duration: 31_000 })).toBe(MSG);
    expect(videoLimitProblem({ type: 'video', duration: 30_000 })).toBeNull();
    await expect(addCreativeToLibrary('p1', { type: 'video', uri: 'file:///long.mov', duration: 45_000 })).rejects.toThrow(MSG);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    // nothing in the app trims: no trimming API or library is referenced anywhere
    const svc = read('src/services/businessFulfillment.js') + read('src/components/CreativeLibrarySection.js');
    expect(svc).not.toMatch(/trimVideo|ffmpeg|VideoTrimmer/i);
  });

  test('a refused file reaches the owner as the server\'s message', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'That photo or video is not available to add.' }) });
    await expect(addCreativeToLibrary('p1', { type: 'image', uri: 'file:///a.jpg' })).rejects.toThrow(/not available to add/);
  });

  test('a screening outage is a service failure (Try again), never a verdict', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'x', code: 'screening_unavailable' }) });
    await expect(addCreativeToLibrary('p1', { type: 'image', uri: 'file:///a.jpg' })).rejects.toMatchObject({ status: 503 });
  });

  test('try again re-checks the saved item by id, with nothing re-uploaded', async () => {
    await retryCreativeCheck('p1', 'c9');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ partnerId: 'p1', targetType: 'creative', creativeId: 'c9' });
  });

  test('the website adds photos only', async () => {
    mockPlatform.OS = 'web';
    await expect(addCreativeToLibrary('p1', { type: 'video', uri: 'blob:x', duration: 5000 })).rejects.toThrow();
    const section = read('src/components/CreativeLibrarySection.js');
    expect(section).toMatch(/pickBusinessOfferMedia\(\{ imagesOnly: Platform\.OS === 'web' \}\)/);
  });
});

describe('logo upload', () => {
  test('a logo is a new stored file every time (write-once), in the business folder of business-logos', async () => {
    const a = await uploadBusinessLogo('p1', { type: 'image', uri: 'file:///logo.png' });
    const [bucket, p, , opts] = mockUpload.mock.calls[0];
    expect(bucket).toBe('business-logos');
    expect(p).toMatch(/^p1\/logo-\d+\.png$/);
    expect(opts).toMatchObject({ upsert: false, contentType: 'image/png' });
    expect(isStoredLogoUrl(a, 'p1', 'https://proj.supabase.co')).toBe(true);
  });

  test('a video is never a logo', async () => {
    await expect(uploadBusinessLogo('p1', { type: 'video', uri: 'file:///v.mov' })).rejects.toThrow(/image/);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('only a file in this business\'s own folder counts as a stored logo', () => {
    const base = 'https://proj.supabase.co/storage/v1/object/public/business-logos/';
    expect(isStoredLogoUrl(`${base}p1/logo-1.png`, 'p1', 'https://proj.supabase.co/')).toBe(true);
    expect(isStoredLogoUrl(`${base}p2/logo-1.png`, 'p1', 'https://proj.supabase.co')).toBe(false);
    expect(isStoredLogoUrl('https://cdn.example.com/logo.png', 'p1', 'https://proj.supabase.co')).toBe(false);
    expect(isStoredLogoUrl(null, 'p1', 'https://proj.supabase.co')).toBe(false);
  });

  test('the server refuses a new logo that is not such a file, and still classifies the image', () => {
    const fn = read('supabase/functions/screen-business-content/index.ts');
    expect(fn).toMatch(/if \(logoChanged && !logoUrl!\.startsWith\(`\$\{SUPABASE_URL\}\/storage\/v1\/object\/public\/business-logos\/\$\{partnerId\}\/`\)\)/);
    expect(fn).toMatch(/if \(logoChanged\) \{\s*const imageResult = await classifyImage\(logoUrl\)/);
  });

  test('the profile editor has an upload, not a typed logo address', () => {
    const src = read('src/screens/BusinessDashboardScreen.js');
    expect(src).not.toMatch(/logoImageUrlOptional/);
    expect(src).not.toMatch(/onChangeText=\{setEditLogoUrlInput\}/);
    expect(src).toMatch(/uploadBusinessLogo\(selectedPartner\.id, asset\)/);
  });
});

describe('surfaces', () => {
  test('the library is on the Profile tab and the welcome steps point to it', () => {
    const src = read('src/screens/BusinessDashboardScreen.js');
    const profileStart = src.indexOf("{on('profile') && (");
    expect(profileStart).toBeGreaterThan(-1);
    expect(src.indexOf('<CreativeLibrarySection', profileStart)).toBeGreaterThan(profileStart);
    expect(src).toMatch(/onPress=\{openCreativeLibrary\}[\s\S]{0,500}ui\.bizHelp\.library\.welcomeStep/);
  });

  test('never on the business application form (an applicant has no account to own the files)', () => {
    for (const f of ['src/screens/BusinessPartnerApplyScreen.js', 'docs/business.html']) {
      const src = read(f);
      expect(src).not.toMatch(/CreativeLibrarySection|addCreativeToLibrary|targetType: 'creative'/);
    }
  });

  test('a library item becomes ready only on a clean (low) screening; held items wait for the team', () => {
    const fn = read('supabase/functions/screen-business-content/index.ts');
    const branch = fn.slice(fn.indexOf("if (targetType === 'creative')"), fn.indexOf("if (targetType === 'business_profile')"));
    expect(branch).toMatch(/else if \(m\.tier === 'low'\) patch = \{ status: 'ready'/);
    expect(branch).toMatch(/else if \(m\.tier === 'high'\) patch = \{ status: 'needs_changes'/);
    expect(branch).toMatch(/else patch = \{ status: 'reviewing', screening_id: screeningId \}/);
    expect(branch).toMatch(/if \(m\.service\) patch = \{ status: 'retry' \}/);
    expect((branch.match(/status: 'ready'/g) || []).length).toBe(1);
  });
});

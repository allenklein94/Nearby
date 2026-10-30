// Profile photo links (owner, 2026-10-28; with 20270349): signed URLs are bearer links the server can't revoke, so every
// profile-photos link is signed for PROFILE_PHOTO_URL_LIFETIME_S (15 min) and cached no longer; uploads never overwrite
// in place (the database refuses it) and the bucket is never read through a public URL.
const fs = require('fs');
const path = require('path');

const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const files = ['photos.js', 'extraPhotos.js'];

describe('profile photo links', () => {
  test('one short lifetime, 15 minutes', () => {
    expect(src('photos.js')).toMatch(/export const PROFILE_PHOTO_URL_LIFETIME_S = 900;/);
  });

  test.each(files)('%s signs and caches profile photos only for that lifetime', (f) => {
    const s = src(f);
    const signs = s.match(/createSignedUrl\([^)]*\)/g) || [];
    expect(signs.length).toBeGreaterThan(0);
    signs.forEach((c) => expect(c).toMatch(/PROFILE_PHOTO_URL_LIFETIME_S\)$/));
    const uploads = s.match(/\.upload\([^;]*\);/g) || [];
    expect(uploads.length).toBe(1);
    expect(uploads[0]).toMatch(/cacheControl: String\(PROFILE_PHOTO_URL_LIFETIME_S\)/);
    expect(uploads[0]).not.toMatch(/upsert/);
    expect(s).not.toMatch(/getPublicUrl/);
  });

  test('no other app code reads the profile-photos bucket', () => {
    const root = path.join(__dirname, '..');
    const hits = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'journeys' && e.name !== 'node_modules') walk(p); return; }
      if (!/\.js$/.test(e.name) || /\.test\.js$/.test(e.name)) return;
      if (fs.readFileSync(p, 'utf8').includes("'profile-photos'")) hits.push(path.relative(root, p));
    });
    walk(root);
    // AdminReviewScreen: the website's admin case review signs 15-minute links for case photos only (Storage re-checks the
    // admin per file, 20270369); it can't import services/photos.js (native picker/file-system modules on the website)
    expect(hits.sort()).toEqual(['screens/AdminReviewScreen.js', 'services/extraPhotos.js', 'services/photos.js']);
  });
});

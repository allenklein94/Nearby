// Business website (owner, 2026-11-14): profile photos upload from a browser (no expo-file-system there).
import fs from 'fs';
import path from 'path';

jest.mock('./supabase', () => ({ supabase: {}, functionUrl: (n) => n }));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('react-native', () => ({ Alert: {}, Platform: { OS: 'ios' } }));
const { webProfilePhotoType } = require('./photos');

test('the stored type follows the file (jpeg default)', () => {
  expect(webProfilePhotoType('image/png')).toEqual({ contentType: 'image/png', ext: 'png' });
  expect(webProfilePhotoType('image/webp')).toEqual({ contentType: 'image/webp', ext: 'webp' });
  expect(webProfilePhotoType('image/jpeg')).toEqual({ contentType: 'image/jpeg', ext: 'jpg' });
  expect(webProfilePhotoType('')).toEqual({ contentType: 'image/jpeg', ext: 'jpg' });
});

test('web reads the picked blob; native keeps the base64 path; web skips the camera/library confirm box', () => {
  const src = fs.readFileSync(path.join(__dirname, 'photos.js'), 'utf8');
  expect(src).toMatch(/if \(Platform\.OS === 'web'\) \{\s*const blob = await \(await fetch\(asset\.uri\)\)\.blob\(\);/);
  expect(src).toMatch(/FileSystem\.readAsStringAsync\(asset\.uri/);
  expect(src).toMatch(/if \(Platform\.OS === 'web'\) return pickFromLibrary\(\);/);
});

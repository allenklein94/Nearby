import { createDraftStore, DRAFT_TTL_MS, draftKey, serializableAsset } from '../services/formDrafts';
import fs from 'fs';
import path from 'path';

function memory() {
  const m = new Map();
  return { getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, v); }, removeItem: async (k) => { m.delete(k); }, m };
}

describe('form drafts (item 82)', () => {
  test('save, load, clear round trip', async () => {
    const st = createDraftStore(memory());
    await st.save('u1', 'gathering', { title: 'Coffee' });
    expect((await st.load('u1', 'gathering')).data).toEqual({ title: 'Coffee' });
    await st.clear('u1', 'gathering');
    expect(await st.load('u1', 'gathering')).toBeNull();
  });
  test('scoped per user', async () => {
    const st = createDraftStore(memory());
    await st.save('u1', 'offer:a', { x: 1 });
    expect(await st.load('u2', 'offer:a')).toBeNull();
  });
  test('expires after 14 days and is removed', async () => {
    const mem = memory(); let t = 1000;
    const st = createDraftStore(mem, () => t);
    await st.save('u1', 'g', { a: 1 });
    t += DRAFT_TTL_MS + 1;
    expect(await st.load('u1', 'g')).toBeNull();
    expect(mem.m.has(draftKey('u1', 'g'))).toBe(false);
  });
  test('corrupt or wrong-version data is ignored, storage errors never throw', async () => {
    const mem = memory();
    mem.m.set(draftKey('u1', 'g'), '{nope');
    const st = createDraftStore(mem);
    expect(await st.load('u1', 'g')).toBeNull();
    const broken = createDraftStore({ getItem: async () => { throw new Error('x'); }, setItem: async () => { throw new Error('x'); }, removeItem: async () => { throw new Error('x'); } });
    await expect(broken.save('u', 'n', {})).resolves.toBeUndefined();
    expect(await broken.load('u', 'n')).toBeNull();
  });
  test('media reference is kept on native only', () => {
    expect(serializableAsset({ uri: 'file:///a.jpg', type: 'image' }, 'ios').uri).toBe('file:///a.jpg');
    expect(serializableAsset({ uri: 'blob:x' }, 'web')).toBeNull();
  });
  test('the three creation flows use drafts and clear on success', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'screens', f), 'utf8');
    for (const [f, hook, clear] of [
      ['CreateGatheringScreen.js', 'gatheringDraft', 'gatheringDraft.clear()'],
      ['BusinessDashboardScreen.js', 'offerDraft', 'offerDraft.clear()'],
      ['AskBusinessScreen.js', 'askDraft', 'askDraft.clear()'],
    ]) {
      const src = read(f);
      expect(src).toContain(`${hook} = useFormDraft(`);
      expect(src).toContain(clear);
      expect(src).toContain('Continue editing'.length ? 'DraftBanner' : '');
    }
  });
});

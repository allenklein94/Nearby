import fs from 'fs';
import path from 'path';
import { pillGlyph, DEFAULT_REPLY_GLYPH } from './offerCopy';

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('owner item 18: the arrival pill carries the push\'s category glyph, same motion', () => {
  it('one known glyph for every reply = that glyph; mixed, unknown or not loaded = ✨', () => {
    expect(pillGlyph([{ requestId: 'a' }], { a: '☕' })).toBe('☕');
    expect(pillGlyph([{ requestId: 'a' }, { requestId: 'b' }], { a: '☕', b: '☕' })).toBe('☕');
    expect(pillGlyph([{ requestId: 'a' }, { requestId: 'b' }], { a: '☕', b: '🍷' })).toBe(DEFAULT_REPLY_GLYPH);
    expect(pillGlyph([{ requestId: 'a' }], {})).toBe(DEFAULT_REPLY_GLYPH);
    expect(pillGlyph([{ requestId: 'a' }], null)).toBe(DEFAULT_REPLY_GLYPH);
    expect(pillGlyph([], { a: '☕' })).toBe(DEFAULT_REPLY_GLYPH);
  });

  it('one source: the server reads the push\'s own mapping, requester only, structured fields only', () => {
    const sql = read('supabase/migrations/20270293_reply_glyphs.sql');
    expect(sql).toMatch(/_offer_push_emoji\(br\.category, \(select oc\.occasion_type from _occasion_context_for_business_request\(br\.id\) oc\)\)/);
    expect(sql).toMatch(/br\.requester_id = auth\.uid\(\)/);
    expect(sql).not.toMatch(/raw_text|offer_title|description/);
  });

  it('the pill keeps its motion: same pulse whatever the glyph, no new animation family', () => {
    const c = read('src/components/OfferArrivalSignal.js');
    expect(c).toMatch(/<Animated\.Text style=\{\[styles\.sparkle, \{ opacity: glyphs \? sparkle : 0 \}\]\}>\{glyph\}<\/Animated\.Text>/);
    expect(c).toMatch(/pulse\(0\.35\), pulse\(1\), pulse\(0\.35\), pulse\(1\)/);
    expect(c).not.toMatch(/glyph === '☕'|steam|wave|kinetic/);
  });
});

describe('the glyph read stays read-only and outside the arrival source', () => {
  it('only calls get_reply_glyphs, writes nothing', () => {
    const s = read('src/services/replyGlyphs.js');
    expect(s).toMatch(/rpc\('get_reply_glyphs'/);
    expect(s).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|accept/);
  });
});

// Item 93 (owner, 2026-10-15): what a friend may see about your open request = structured facts only, everywhere it is shown.
import fs from 'fs';
import path from 'path';
import { sharedRequestFactsLine } from './sharedRequestFacts';
import { setCurrentLanguage } from '../i18n/translate';

const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('sharedRequestFactsLine', () => {
  beforeEach(() => setCurrentLanguage('en'));
  test('category · day · party size, each only when set', () => {
    expect(sharedRequestFactsLine({ category: 'Coffee', date: '2026-10-16', party_size: 3 })).toMatch(/^Coffee · .+ · 3 people$/);
    expect(sharedRequestFactsLine({ category: 'Coffee' })).toBe('Coffee');
    expect(sharedRequestFactsLine({ category: null, date: null, party_size: null })).toBeNull();
    expect(sharedRequestFactsLine({ category: 'Coffee', party_size: 0 })).toBe('Coffee');
  });
  test('never reads the typed words even when a row carries them', () => {
    expect(sharedRequestFactsLine({ category: 'Coffee', raw_text: 'vegan, nut allergy, with my ex' })).toBe('Coffee');
  });
});

describe('guards: no raw text, friends only, opt-in', () => {
  test('the candidate rows and the typed-ask friend result use the shared line, never raw_text or match_id', () => {
    const screen = src('screens/BusinessRequestDetailScreen.js');
    expect(screen).not.toMatch(/c\.raw_text/);
    expect(screen).toMatch(/sharedRequestFactsLine\(c\)/);
    const resolver = src('services/intentResolver.js');
    const fn = resolver.slice(resolver.indexOf('async function resolveConnectedRequests'), resolver.indexOf('async function resolvePerks'));
    expect(fn).toMatch(/subtitle: sharedRequestFactsLine\(r\)/);
    expect(fn).not.toMatch(/raw_text|match_id/);
  });
  test('Settings is OFF unless the person picks Friends; the old friends-and-matches value is gone from the app', () => {
    const settings = src('screens/SettingsScreen.js');
    expect(settings).toMatch(/useState\('nobody'\)/);
    expect(settings).toMatch(/data\.intent_visibility \?\? 'nobody'/);
    expect(settings).not.toMatch(/friends_and_matches|friendsMatches/);
  });
  test('the migration: opt-in default, everyone reset, friends only, no raw_text returned', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270307_intent_visibility_friends_opt_in.sql'), 'utf8');
    expect(sql).toMatch(/set default 'nobody'/);
    expect(sql).toMatch(/update public\.profiles set intent_visibility = 'nobody'/);
    expect(sql).not.toMatch(/from matches/);
    const rpc = sql.slice(sql.indexOf('CREATE FUNCTION public.get_connected_open_business_requests'), sql.indexOf('revoke all on function public.get_connected_open_business_requests'));
    expect(rpc).not.toMatch(/raw_text|match_id/);
  });
});

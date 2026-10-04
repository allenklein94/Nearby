// Flywheel gap 1 (owner, 2026-10-03, LOCKED): a gathering records the typed ask it was EXPLICITLY created from ("Create it
// yourself"), as gatherings.submission_id -> intent_submissions.id. Nothing else attributes a gathering to an ask, and
// nothing reads the field. Database rules (own ask only, immutable, business attribution unchanged) are proven live by
// src/journeys/askGatheringAttribution.journey.js.
import fs from 'fs';
import path from 'path';

jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('./supabase', () => ({ supabase: {} }));

import { routeClassifiedIntentToCreation } from './createAssistant';
import { resolveAsk, toClassification } from '../utils/askResolver';

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const nav = () => ({ navigate: jest.fn() });
const ask = (t) => toClassification(resolveAsk(t, null));
const SUB = '0b6a9c1e-1111-4222-8333-444455556666';

describe('typed ask -> Create it yourself -> the ask id travels with Create', () => {
  it('explicit create carries the ask id to CreateGathering', () => {
    const n = nav();
    routeClassifiedIntentToCreation(n, ask('coffee tonight with friends'), 'coffee tonight with friends', { explicitCreate: true, submissionId: SUB });
    expect(n.navigate).toHaveBeenCalledWith('CreateGathering', expect.objectContaining({ quickStartSubmissionId: SUB }));
  });

  it('a gathering-intent route to Create carries it only when the button passed it (Celebrate)', () => {
    const r = { ...ask('coffee tonight'), intent: 'gathering' };
    const withId = nav();
    routeClassifiedIntentToCreation(withId, r, 'coffee tonight', { submissionId: SUB });
    expect(withId.navigate.mock.calls[0][1].quickStartSubmissionId).toBe(SUB);
    const without = nav();
    routeClassifiedIntentToCreation(without, r, 'coffee tonight');
    expect(without.navigate.mock.calls[0][1]).not.toHaveProperty('quickStartSubmissionId');
  });

  it('independent Create (no ask id) and the same words without an id carry nothing: no inference from category, text or time', () => {
    const n = nav();
    routeClassifiedIntentToCreation(n, ask('coffee tonight with friends'), 'coffee tonight with friends', { explicitCreate: true });
    expect(n.navigate.mock.calls[0][1]).not.toHaveProperty('quickStartSubmissionId');
  });

  it('never attached to a non-gathering destination', () => {
    const n = nav();
    routeClassifiedIntentToCreation(n, { intent: 'community', title: 'Run club', category: 'Running' }, 'start a run club', { explicitCreate: true, submissionId: SUB });
    expect(n.navigate.mock.calls[0][0]).toBe('CreateCommunity');
    expect(n.navigate.mock.calls[0][1]).not.toHaveProperty('quickStartSubmissionId');
    const b = nav();
    routeClassifiedIntentToCreation(b, { intent: 'business_partner', businessName: 'X' }, 'partner with X', { explicitCreate: true, submissionId: SUB });
    expect(b.navigate.mock.calls[0][1]).not.toHaveProperty('quickStartSubmissionId');
  });
});

describe('only the Create-it-yourself buttons pass the id', () => {
  it('Home: only explicit create passes it; the automatic fall-through does not', () => {
    const src = read('src/screens/HomeScreen.js');
    expect(src).toMatch(/routeClassifiedIntentToCreation\(navigation, result, typedText, opts\?\.explicitCreate \? \{ \.\.\.opts, submissionId \} : opts\)/);
    expect(src.match(/proceedToCreation\([^)]*\{ explicitCreate: true \}\)/g)).toHaveLength(2);
  });
  it('Discover: only createFromAsk (the ask it understood) passes it; a fresh classify has no ask id', () => {
    const src = read('src/screens/DiscoverHubScreen.js');
    expect(src.match(/explicitCreate: true, submissionId: intentSearch\.submissionId/g)).toHaveLength(1);
    expect(src).toMatch(/routeClassifiedIntentToCreation\(navigation, result, typedText, \{ explicitCreate: true \}\)/);
    expect(src).toMatch(/routeClassifiedIntentToCreation\(navigation, result\.classifyResult, typedText\);/);
  });
  it('Celebrate: only its "Create it yourself" passes it', () => {
    const src = read('src/screens/CelebrateSomethingScreen.js');
    expect(src.match(/routeClassifiedIntentToCreation\([^)]*submissionId/g)).toHaveLength(1);
    expect(src).toMatch(/function proceedToCustomCreation\(\) \{\n[^\n]*\n\s*routeClassifiedIntentToCreation\(navigation, classifyResult, typedText, \{ submissionId, onTop: true \}\)/);
  });
  it('CreateGathering sends only the route param it was given (never a draft value) and createGathering writes it only on insert', () => {
    const screen = read('src/screens/CreateGatheringScreen.js');
    expect(screen.match(/quickStartSubmissionId/g)).toHaveLength(1);
    expect(screen).toMatch(/submissionId: route\.params\?\.quickStartSubmissionId \?\? null/);
    const g = read('src/services/gatherings.js');
    expect(g.match(/submission_id/g)).toHaveLength(1);
    expect(g).toMatch(/\.\.\.\(submissionId \? \{ submission_id: submissionId \} : \{\}\)/);
  });
});

describe('recording only', () => {
  it('no app code and no edge function reads a gathering submission id', () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'supabase/functions'))]
      .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.test.js') && !f.endsWith('.journey.js'));
    for (const f of files) {
      // the three files that carry it into the insert (route -> screen -> insert); nothing else may mention it
      if (['services/gatherings.js', 'services/createAssistant.js', 'screens/CreateGatheringScreen.js'].some((x) => f.endsWith(path.join(...x.split('/'))))) continue;
      const src = fs.readFileSync(f, 'utf8');
      expect(src).not.toMatch(/quickStartSubmissionId|gatherings?\.submission_id|g\.submission_id/);
    }
  });
  it('the migration adds one nullable column + its guard and touches no view or other function', () => {
    const code = read('supabase/migrations/20270272_gathering_submission_id.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).toMatch(/add column if not exists submission_id uuid references public\.intent_submissions\(id\) on delete set null/);
    expect(code).not.toMatch(/not null default|create or replace view|intent_funnel|request_journey|business_requests|\bupdate public\.|\binsert into\b/i);
    expect(code.match(/create or replace function/g)).toHaveLength(1);
  });
});

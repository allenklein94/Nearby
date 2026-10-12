// Owner item 82 (2026-10-12): "Create it" shows what the ask gave as soon as Create opens. The "From what you said" card on step 1
// (and step 2 as before), the same rows and Hide, settling in once on item 45's small tokens only on the step Create opened on.
// Played on the real router: typed ask -> routeClassifiedIntentToCreation -> the params Create reads -> the card's rule.
import fs from 'fs';
import path from 'path';

jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('../services/supabase', () => ({ supabase: {} }));

import { routeClassifiedIntentToCreation } from '../services/createAssistant';
import { resolveAsk, toClassification } from './askResolver';
import { startAfterWhatStep } from './gatheringStructure';
import { SUMMARY_LAYERS, fromWhatYouSaidRows, fromWhatYouSaidOnStep, fromWhatYouSaidGuidance, fromWhatYouSaidSettles } from './fromWhatYouSaid';
import { SEQUENCES } from '../motion/motionBudget';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
function createFrom(text) {
  const n = { navigate: jest.fn() };
  routeClassifiedIntentToCreation(n, toClassification(resolveAsk(text, null)), text, { explicitCreate: true });
  expect(n.navigate.mock.calls[0][0]).toBe('CreateGathering');
  const params = n.navigate.mock.calls[0][1];
  return { params, rows: fromWhatYouSaidRows(params), openedOn: startAfterWhatStep(params) ? 'whenWhere' : 'what' };
}
const facts = (rows) => rows.map((r) => `${r.layer}:${r.key}`);

describe('the card on step 1 when Create opens there from an ask', () => {
  it('a partly understood ask opens on step 1 and its carried facts show there at once, settling once', () => {
    const c = createFrom('hang out with 4 friends tomorrow');
    expect(c.openedOn).toBe('what');
    expect(facts(c.rows)).toEqual(['purpose:friends', 'time:tomorrow', 'people:5']);
    expect(fromWhatYouSaidOnStep('what', c.rows, false)).toBe(true);
    expect(fromWhatYouSaidSettles('what', c.openedOn)).toBe(true);
    expect(fromWhatYouSaidGuidance('what')).toBe(false); // the step-2 line ("Pick a time, then a place") stays on step 2
  });

  it('the same card stays on step 2, unchanged: guidance line, no settle', () => {
    const c = createFrom('something fun tonight');
    expect(facts(c.rows)).toEqual(['time:tonight']);
    expect(fromWhatYouSaidOnStep('whenWhere', c.rows, false)).toBe(true);
    expect(fromWhatYouSaidGuidance('whenWhere')).toBe(true);
    expect(fromWhatYouSaidSettles('whenWhere', c.openedOn)).toBe(false);
  });

  it('a fully understood ask still opens on step 2 with the card (as before); Back to step 1 shows it there, without a settle', () => {
    const c = createFrom('Pickleball tonight');
    expect(c.openedOn).toBe('whenWhere');
    expect(c.params.quickStartTitle).toBe('Pickleball');
    expect(facts(c.rows)).toEqual(['activity:Pickleball', 'time:tonight']);
    expect(fromWhatYouSaidSettles('whenWhere', c.openedOn)).toBe(false);
    expect(fromWhatYouSaidOnStep('what', c.rows, false)).toBe(true);
    expect(fromWhatYouSaidSettles('what', c.openedOn)).toBe(false);
  });

  it('Hide hides the one card on both steps; nothing on later steps; nothing without carried facts', () => {
    const { rows } = createFrom('hang out with 4 friends tomorrow');
    for (const s of ['what', 'whenWhere']) expect(fromWhatYouSaidOnStep(s, rows, true)).toBe(false);
    for (const s of ['who', 'details', 'publish']) expect(fromWhatYouSaidOnStep(s, rows, false)).toBe(false);
    expect(fromWhatYouSaidOnStep('what', [], false)).toBe(false);
    expect(fromWhatYouSaidRows({})).toEqual([]);
    expect(fromWhatYouSaidRows(null)).toEqual([]);
  });

  it('never a location or setting: "near me" is Create\'s default, not carried, even when the words name one', () => {
    expect(SUMMARY_LAYERS).toEqual(['activity', 'purpose', 'time', 'people']);
    for (const text of ['pickleball near me tonight', 'coffee outdoors tomorrow', 'indoor rock climbing nearby']) {
      const { rows } = createFrom(text);
      expect(rows.every((r) => SUMMARY_LAYERS.includes(r.layer))).toBe(true);
    }
    expect(fromWhatYouSaidRows({ inferredSummary: [{ layer: 'where', value: 'Near you' }, { layer: 'time', key: 'tonight' }] }).map((r) => r.layer)).toEqual(['time']);
  });
});

describe('the screen and the card: one card, no new strings or motion mechanism, never delays opening', () => {
  const screen = read('screens/CreateGatheringScreen.js');
  const card = read('components/FromWhatYouSaidCard.js');

  it('Create renders the one card at the top of step 1 (before the title) and on step 2, through the shared rule', () => {
    expect(screen).toMatch(/\{stepKey === 'what' && renderFromWhatYouSaid\(\)\}\s*\{stepKey === 'what' && \(\s*<>\s*<Text style=\{styles\.label\}>\{t\('gatherings\.titleLabel'\)\}/);
    expect(screen).toContain("{stepKey === 'whenWhere' && renderFromWhatYouSaid()}");
    expect((screen.match(/<FromWhatYouSaidCard/g) || []).length).toBe(1);
    expect(screen).toContain('fromWhatYouSaidOnStep(stepKey, inferredRows, inferredDismissed)');
    expect(screen).toContain('onHide={() => setInferredDismissed(true)}');
    expect(screen).not.toMatch(/SUMMARY_LAYERS/);
  });

  it('the card reuses item 45\'s approved small tokens, readable from frame one, native driver, Reduce Motion settled', () => {
    expect(card).toContain('const T = SEQUENCES.askUnderstood;');
    expect(SEQUENCES.askUnderstood.tier).toBe('small');
    expect(card).toContain('infoOpacity(v)');
    expect(card).toContain('useNativeDriver: true');
    expect(card).toMatch(/useState\(\(\) => !!settle && !reduceMotion\)/);
    // once per Create: Back to step 1 later never replays it
    expect(screen).toContain('settle={!fromWhatYouSaidSettled && fromWhatYouSaidSettles(stepKey, openedOnStepKey)}');
    expect(screen).toContain('onSettled={() => setFromWhatYouSaidSettled(true)}');
    expect(card).toContain('if (settle && onSettled) onSettled();');
    expect(card).not.toMatch(/MOTION_BUDGET|LayoutAnimation|setTimeout|\.loop\(|Haptics/);
    // the same strings the step-2 card always used, nothing new
    const keys = [...card.matchAll(/t\('([^']+)'\)/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(['ui.gatheringForm.fromWhatYouSaid', 'ui.gatheringForm.fromWhatYouSaid', 'ui.gatheringForm.hide', 'ui.gatheringForm.hideSummaryA11y']);
  });

  it('"Create it" navigates at once: no cross-screen transition, nothing awaited or timed before navigate', () => {
    const svc = read('services/createAssistant.js');
    const fn = svc.slice(svc.indexOf('export function routeClassifiedIntentToCreation'), svc.indexOf('\n}\n', svc.indexOf('export function routeClassifiedIntentToCreation')));
    expect(fn).not.toMatch(/await|setTimeout|sharedElement|SharedElement|Animated/);
    expect(screen).not.toMatch(/sharedTransitionTag|SharedElement/);
  });
});

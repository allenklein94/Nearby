const fs = require('fs');
const path = require('path');
const { planParts, planAsk, occasionFromAsk, recipeForPlan, planCaption } = require('./planAsk');
const { deterministicClassification } = require('./gatheringInference');
const { experienceContextKey, CONTEXT_TEMPLATES, EXPERIENCE_TEMPLATES } = require('../constants/experienceTemplates');

const OWNER = 'I want something fun with my wife tonight, maybe dinner and something to do after.';

describe('item 63: one plan, not a category choice', () => {
  it('the owner example reads as couple + date night + tonight + dinner then activity', () => {
    const c = deterministicClassification(OWNER);
    expect(c).toMatchObject({ intent: 'gathering', category: null, partyType: 'date', dateWindow: 'tonight', occasion: 'date_night' });
    expect(planParts(OWNER).map((p) => p.key)).toEqual(['activity', 'food']);
    expect(planCaption(OWNER, { occasion: 'date_night', dateWindow: 'tonight' })).toBe('Planning a date night tonight: something to do, then dinner');
    // The occasion has a real cross-category template (dinner / something to do / finish the night).
    expect(EXPERIENCE_TEMPLATES.date_night.components.map((c) => c.key)).toEqual(['dinner', 'something_to_do', 'finish_the_night']);
  });
  it('the order shown follows the person\'s words', () => {
    expect(planParts('dinner and a movie tonight').map((p) => p.key)).toEqual(['food', 'activity']);
    expect(planCaption('dinner and a movie tonight', { dateWindow: 'tonight' })).toBe('Planning your plan tonight: dinner, then something to do');
  });
});

describe('only a real multi-part ask counts', () => {
  it('one part is not a plan', () => {
    expect(planAsk('dinner tonight')).toBeNull();
    expect(planAsk('something fun tonight')).toBeNull();
    expect(deterministicClassification('coffee tonight').category).toBe('Coffee');
  });
  it('occasion only from explicit words, or a couple planning a multi-part evening', () => {
    expect(occasionFromAsk('anniversary dinner')).toBe('anniversary');
    expect(occasionFromAsk('dinner with my wife', { partyType: 'date' })).toBeNull(); // one part, no evening
    expect(occasionFromAsk('dinner and a show with my wife', { partyType: 'date' })).toBeNull(); // no evening said
    expect(occasionFromAsk('dinner and a show with my wife tonight', { partyType: 'date', dateWindow: 'tonight' })).toBe('date_night');
    expect(occasionFromAsk('dinner and a show with friends tonight', { partyType: 'friends', dateWindow: 'tonight' })).toBeNull();
  });
  it('a plan with no party still uses an EXISTING recipe, and still needs a real planning window', () => {
    expect(recipeForPlan('dinner and a movie tonight')).toBe('date_night');
    expect(recipeForPlan('lunch and a museum', { dateWindow: 'weekend' })).toBe('friends_out');
    expect(recipeForPlan('dinner')).toBeNull();
    for (const k of ['date_night', 'friends_out']) expect(CONTEXT_TEMPLATES[k]).toBeTruthy();
    expect(experienceContextKey({ intentRecipe: 'friends_out', dateWindow: null })).toBeNull(); // no time given = no plan invented
  });
});

describe('resolver wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/intentResolver.js'), 'utf8');
  it('drops the single category for a multi-part ask, fills occasion only when absent, and captions the plan', () => {
    expect(src).toMatch(/if \(multiPart\) category = null;/);
    expect(src).toMatch(/occasion = occasion \?\? occasionFromAsk/);
    expect(src).toMatch(/planCaption\(rawText, \{ occasion, dateWindow \}\)/);
    expect(src).toMatch(/intentRecipeFor\(rawText\) \?\? recipeForPlan\(rawText, \{ dateWindow \}\)/);
  });
  it('never uses AI or the network', () => {
    const mod = fs.readFileSync(path.join(__dirname, 'planAsk.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(mod).not.toMatch(/fetch\(|supabase|anthropic/i);
  });
});

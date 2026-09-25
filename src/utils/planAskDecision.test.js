// Owner decision on item 63 (2026-09-25): Nearby can understand WHAT the person wants, but never invents WHEN.
const fs = require('fs');
const path = require('path');
const { assembleExperience } = require('../services/experienceAssembly');
const { resolveAsk, toClassification } = require('./askResolver');
const deterministicClassification = (t) => toClassification(resolveAsk(t));
const { recipeForPlan, planAsk } = require('./planAsk');
const { intentRecipeFor } = require('../constants/intentRoutes');

// Real supply for two different parts of a night, as resolveIntent candidates.
const SUPPLY = [
  { id: 'g1', type: 'gathering', category: 'Restaurants', score: 5 },
  { id: 'g2', type: 'gathering', category: 'Live Music', score: 4 },
];

// Exactly what resolveIntent passes to assembleExperience for an ask, using the no-AI classification.
function planFor(text, supply = SUPPLY) {
  const c = deterministicClassification(text);
  return {
    c,
    experience: assembleExperience(c.occasion, supply, {
      partyType: c.partyType, dateWindow: c.dateWindow, attributes: [],
      intentRecipe: intentRecipeFor(text) ?? recipeForPlan(text, { dateWindow: c.dateWindow }),
    }),
  };
}

describe('no time word = no combined plan, no time', () => {
  it('"dinner and a show with my wife"', () => {
    const { c, experience } = planFor('dinner and a show with my wife');
    expect(c).toMatchObject({ partyType: 'date', dateWindow: null, occasion: null });
    expect(experience).toBeNull();
  });
});

describe('an explicit time word activates the plan', () => {
  it('"dinner and a show with my wife tonight" -> date night, each part from its own supply', () => {
    const { c, experience } = planFor('dinner and a show with my wife tonight');
    expect(c).toMatchObject({ category: null, occasion: 'date_night', dateWindow: 'tonight' });
    expect(experience.occasion).toBe('date_night');
    expect(experience.components.map((x) => x.key)).toEqual(['dinner', 'something_to_do']);
  });
  it('a part with no real supply is omitted, never invented', () => {
    const { experience } = planFor('dinner and a show with my wife tonight', [SUPPLY[0]]);
    expect(experience.components.map((x) => x.key)).toEqual(['dinner']);
    expect(experience.components.find((x) => x.key === 'finish_the_night')).toBeUndefined();
  });
  it('"date night tonight" -> explicit date-night occasion + Tonight', () => {
    expect(deterministicClassification('date night tonight')).toMatchObject({ occasion: 'date_night', dateWindow: 'tonight' });
  });
  it('"anniversary dinner tonight" -> anniversary occasion + Tonight', () => {
    expect(deterministicClassification('anniversary dinner tonight')).toMatchObject({ occasion: 'anniversary', dateWindow: 'tonight' });
  });
});

describe('single part and category alone', () => {
  it('"dinner tonight" stays the single-part flow', () => {
    const c = deterministicClassification('dinner tonight');
    expect(planAsk('dinner tonight')).toBeNull();
    expect(c).toMatchObject({ category: 'Restaurants', occasion: null, dateWindow: 'tonight' });
  });
  it.each(['dinner tonight', 'restaurant tonight', 'a movie tonight', 'dinner and a movie tonight'])('a category alone never makes a date night: %s', (t) => {
    expect(deterministicClassification(t).occasion).toBeNull();
  });
});

describe('identical with or without the AI', () => {
  it('the resolver applies the same occasion rule as the fallback, whatever the classifier said', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/intentResolver.js'), 'utf8');
    expect(src).toMatch(/occasion = occasion \?\? occasionFromAsk\(rawText, \{ partyType, dateWindow \}\);/);
    expect(src).toMatch(/if \(multiPart\) category = null;/);
    // Time reaches assembly only as the classifier's/rules' dateWindow; the resolver never sets one itself.
    expect(src).not.toMatch(/dateWindow = ['"](tonight|today|tomorrow|weekend)['"]/);
  });
});

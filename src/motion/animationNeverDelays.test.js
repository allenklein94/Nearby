import fs from 'fs';
import path from 'path';
import { INFO_REST_OPACITY, infoOpacity, SEQUENCES } from './motionBudget';

// Owner item 19 (2026-10-10, LOCKED): animation never delays the person. Tap -> the information is there at once; motion
// only helps it read. Information-carrying text is readable from the first frame (never below INFO_REST_OPACITY).
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const INFO = {
  'components/OfferAssembly.js': [/const opacity = infoOpacity\(v\);/],
  'motion/OfferAcceptedMorph.js': [/opacity: infoOpacity\(check\)/, /opacity: infoOpacity\(body\)/],
  'motion/BookedCelebration.js': [/Animated\.multiply\(infoOpacity\(card\), exitFade\)/, /opacity: infoOpacity\(text\)/],
  'motion/VisitConfirmed.js': [/opacity: infoOpacity\(v\)/],
  'motion/OfferProgressSteps.js': [/opacity: infoOpacity\(step\)/],
  'motion/RespondingStatus.js': [/opacity: infoOpacity\(fade\)/],
  'motion/SuccessAnimation.js': [/opacity: infoOpacity\(textOpacity\)/],
};

describe('animation never delays the person (item 19)', () => {
  test('the floor is readable and the mapping never goes below it', () => {
    expect(INFO_REST_OPACITY).toBeGreaterThanOrEqual(0.6);
    expect(SEQUENCES.offerAssembly.actionRestOpacity).toBe(INFO_REST_OPACITY);
    const fake = { interpolate: ({ outputRange }) => outputRange };
    expect(infoOpacity(fake)).toEqual([INFO_REST_OPACITY, 1]);
  });
  test.each(Object.entries(INFO))('%s keeps its information readable from the first frame', (file, patterns) => {
    const src = read(file);
    for (const re of patterns) expect(src).toMatch(re);
  });
});

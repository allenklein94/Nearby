// Tell Nearby without the AI reader (owner, 2026-11-15): a keyword-only reading is shown as words picked out of the owner's
// text, never as "We understood your business", and nothing about the business is saved before "Yes, continue".
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'TellNearbyBusinessCard.js'), 'utf8');

test('keyword-only result gets its own heading + "nothing is saved until" line', () => {
  expect(src).toMatch(/setKeywordOnly\(!ai\)/);
  expect(src).toMatch(/keywordOnly \? t\('ui\.bizComp\.pickedOutOfYourWords'\) : t\('ui\.bizComp\.weUnderstoodYourBusiness'\)/);
  expect(src).toMatch(/keywordOnly \? <Text[^>]*>\{t\('ui\.bizComp\.pickedOutOfYourWordsBody'\)\}/);
});

test('business information is written only inside confirm() (the "Yes, continue" button)', () => {
  const confirmStart = src.indexOf('async function confirm()');
  const confirmEnd = src.indexOf('\n  return (', confirmStart);
  expect(confirmStart).toBeGreaterThan(0);
  for (const writer of ['updateBusinessProfile(', 'setBusinessOfferedOccasions(', 'setBusinessAccommodations(']) {
    const calls = [...src.matchAll(new RegExp(writer.replace('(', '\\('), 'g'))].map((m) => m.index)
      .filter((i) => !src.slice(src.lastIndexOf('\n', i), i).trimStart().startsWith('import'));
    expect(calls.length).toBeGreaterThan(0);
    for (const i of calls) expect(i > confirmStart && i < confirmEnd).toBe(true);
  }
  expect(src).toMatch(/onPress=\{confirm\}[^>]*accessibilityLabel=\{t\('ui\.bizComp\.yesContinueA11y'\)\}/);
});

test('every language names the real button in its "nothing is saved" line', () => {
  const strings = require('../i18n/ui/bizComp.js').default;
  for (const [lang, block] of Object.entries(strings)) {
    expect(block.pickedOutOfYourWords).toBeTruthy();
    expect(block.pickedOutOfYourWordsBody).toContain(block.yesContinue.replace(/[“”«»"]/g, ''));
  }
});

// Screen-reduction audit B7 (2026-10-09): asking ONE business for a gathering picks the business in place on Ask a
// business; RequestBusinessPartner keeps only the community partnership request and the Create-tab target choice.
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test("a gathering's Request a specific business opens Ask a business with the picker, not a separate screen", () => {
  const g = read('screens/GatheringDetailScreen.js');
  expect(g).toMatch(/navigation\.navigate\('AskBusiness', \{ gatheringId, gatheringTitle: gathering\.title, pickBusiness: true, partnershipTarget: \{ targetType: 'gathering', targetId: gatheringId \} \}\)/);
  expect(g).not.toMatch(/'RequestBusinessPartner', \{ targetType: 'gathering'/);
});

test('Ask a business shows the picker until a business is chosen, and the chosen one becomes the target', () => {
  const a = read('screens/AskBusinessScreen.js');
  expect(a).toMatch(/const choosingBusiness = pickBusiness && !targetPartner;/);
  expect(a).toMatch(/\{choosingBusiness \? \([\s\S]{0,400}<BusinessPicker initialQuery=\{route\.params\?\.initialBusinessQuery \?\? ''\} onPick=\{setPickedPartner\} \/>/);
  expect(a).toMatch(/targetPartner = route\.params\?\.targetPartner \?\? \(pickedPartner \? \{ id: pickedPartner\.id, name: pickedPartner\.name \} : null\)/);
  // the co-host partnership request still goes out with the ask, unchanged
  expect(a).toMatch(/if \(targetPartner && route\.params\?\.partnershipTarget\)/);
});

test('RequestBusinessPartner hands any gathering to Ask a business and keeps no gathering ask of its own', () => {
  const r = read('screens/RequestBusinessPartnerScreen.js');
  expect(r).toMatch(/if \(item\.type === 'gathering'\) \{[\s\S]{0,200}navigation\.replace\('AskBusiness', \{[\s\S]{0,120}pickBusiness: true/);
  expect(r).not.toMatch(/selectedTarget\?\.type === 'gathering'/);
  expect(r).toMatch(/<BusinessPicker /);
});

test('one business picker: no screen has its own copy', () => {
  for (const f of ['screens/RequestBusinessPartnerScreen.js', 'screens/AskBusinessScreen.js']) {
    expect(read(f)).not.toMatch(/getAllActivePartners|getActivePartnersByName/);
  }
});

const fs = require('fs');
const path = require('path');
const { gatheringEditRefusal } = require('./gatheringEditRefusal');
const strings = require('../i18n/ui/gatheringForm').default;

describe('gatheringEditRefusal (migrations 20270343 + 20270344)', () => {
  test('a booked-time refusal names its explanation; anything else falls through', () => {
    expect(gatheringEditRefusal({ hint: 'gathering_time_booked' })).toEqual({ titleKey: 'ui.gatheringForm.edit.timeBooked', bodyKey: 'ui.gatheringForm.edit.timeBookedBody' });
    expect(gatheringEditRefusal({ hint: 'gathering_request_has_replies' })).toEqual({ titleKey: 'ui.gatheringForm.edit.requestReplied', bodyKey: 'ui.gatheringForm.edit.requestRepliedBody' });
    expect(gatheringEditRefusal({ hint: 'gathering_locked' })).toBeNull();
    expect(gatheringEditRefusal(new Error('network'))).toBeNull();
    expect(gatheringEditRefusal(null)).toBeNull();
  });

  test('all four strings exist in all 11 languages', () => {
    expect(Object.keys(strings)).toHaveLength(11);
    for (const lang of Object.values(strings)) {
      expect(lang.edit.timeBooked).toBeTruthy();
      expect(lang.edit.timeBookedBody).toBeTruthy();
      expect(lang.edit.requestReplied).toBeTruthy();
      expect(lang.edit.requestRepliedBody).toBeTruthy();
    }
  });

  test('EditGathering checks it before its usual Try Again error', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/EditGatheringScreen.js'), 'utf8');
    const catchBlock = src.slice(src.indexOf('} catch (e) {', src.indexOf('await updateGathering(')));
    expect(catchBlock.indexOf('gatheringEditRefusal(e)')).toBeGreaterThan(-1);
    expect(catchBlock.indexOf('gatheringEditRefusal(e)')).toBeLessThan(catchBlock.indexOf('presentRecoverableError'));
  });
});

const fs = require('fs');
const path = require('path');
const { replySentConfirmation, OFFER_QUEUED_CONFIRMATION, inviteSentConfirmation, interestedConfirmation } = require('./actionConfirmations');
const { justSentLine } = require('./requestTimeline');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// Owner item 123: every important action says what happened.
describe('meaningful confirmations', () => {
  it('a business reply confirmation names its real kind (availability is never "Offer sent")', () => {
    expect(replySentConfirmation({ offer_type: 'standard' })[0]).toBe('Reply sent');
    expect(replySentConfirmation({ offer_type: 'standard' }).join(' ')).not.toMatch(/offer/i);
    expect(replySentConfirmation({ offer_type: 'alt_time' })[0]).toBe('New time suggested');
    expect(replySentConfirmation({ offer_type: 'standard', offer_title: '2 coffees + 2 pastries' })[0]).toBe('Offer sent');
    expect(OFFER_QUEUED_CONFIRMATION[0]).toBe('Offer saved');
  });
  it('an invitation names the person', () => {
    expect(inviteSentConfirmation('Claude')[0]).toBe('Invitation sent to Claude');
    expect(inviteSentConfirmation(null)[0]).toBe('Invitation sent');
  });
  it('Interested says saved / removed', () => {
    expect(interestedConfirmation(true)[0]).toBe('Saved to Interested');
    expect(interestedConfirmation(false)[0]).toBe('Removed from Interested');
  });
  it('a request to one business names it; a broadcast counts businesses', () => {
    expect(justSentLine(1, 'Coastal Coffee')).toBe("Request sent to Coastal Coffee. You'll be notified when they respond.");
    expect(justSentLine(4)).toBe("We asked 4 nearby businesses. You'll be notified when they respond.");
    expect(justSentLine(0, 'Coastal Coffee')).toBeNull();
  });
  it('each action is wired to its confirmation', () => {
    const dash = read('screens/BusinessDashboardScreen.js');
    expect(dash).toMatch(/showSuccessToast\(\.\.\.replySentConfirmation\(sent\)\)/);
    expect(dash).toMatch(/\{ offer_type: offerType \}\)/);
    expect(dash).toMatch(/showSuccessToast\(\.\.\.OFFER_QUEUED_CONFIRMATION\)/);
    for (const f of ['screens/GatheringConfirmationScreen.js', 'components/InviteFriendsModal.js']) expect(read(f)).toMatch(/inviteSentConfirmation\(/);
    for (const f of ['screens/GatheringDetailScreen.js', 'screens/HomeScreen.js']) expect(read(f)).toMatch(/interestedConfirmation\(/);
    expect(read('screens/AskBusinessScreen.js')).toMatch(/targetPartnerName: targetPartner\?\.name/);
    expect(read('screens/BusinessRequestDetailScreen.js')).toMatch(/justSentLine\(notifiedCount, targetPartnerName\)/);
    // the two moments that already said what happened stay
    expect(read('screens/GatheringConfirmationScreen.js')).toMatch(/Your gathering is live!/);
    expect(read('screens/BusinessRequestDetailScreen.js')).toMatch(/You're booked\. ✓/);
  });
  it('no screen confirms with a bare "Success!"', () => {
    const dir = path.join(__dirname, '..');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const offenders = walk(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .filter((f) => /(showSuccessToast|Alert\.alert)\(\s*['"]Success!?['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

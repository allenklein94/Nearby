const fs = require('fs');
const path = require('path');
const { replySentConfirmation, OFFER_QUEUED_CONFIRMATION, inviteSentConfirmation, interestedConfirmation } = require('./actionConfirmations');
const { justSentLine } = require('./requestTimeline');
const { submissionView } = require('./offerSubmission');

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
  it('the screened-send list names the reply by kind once it clears; before that it never says sent', () => {
    const pub = (payload) => submissionView({ status: 'published', payload }).headline;
    expect(pub({ offerType: 'standard', offerTitle: '2 coffees + 2 pastries', offerPrice: 12 })).toBe('Offer sent');
    expect(pub({ offerType: 'standard', offerDescription: 'We can do it.' })).toBe('Reply sent');
    expect(pub({ offerType: 'alt_time' })).toBe('New time suggested');
    expect(pub(undefined)).toBe('Reply sent');
    for (const status of ['reviewing', 'in_review', 'needs_changes', 'not_sent', 'unavailable']) {
      expect(submissionView({ status }).headline).not.toMatch(/^(Offer|Reply) sent$/);
    }
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
    // the full editor's direct send passes the reply's REAL fields (no placeholder that forces "Offer sent")
    expect(dash).not.toMatch(/offer_title: 'offer'/);
    expect(dash).toMatch(/offer_type: offerTypeInput, offer_title: offerTitleInput/);
    // a published reply is confirmed only on the published branch; held / blocked never say sent
    const handler = dash.slice(dash.indexOf('async function handleOfferResult'), dash.indexOf('function openAlternativeSheet'));
    expect(handler.indexOf('replySentConfirmation')).toBeGreaterThan(handler.indexOf('if (result.published)'));
    expect(handler.indexOf('replySentConfirmation')).toBeLessThan(handler.indexOf('else if (result.blocked)'));
    expect(handler).toMatch(/being reviewed before it’s sent/);
    // the queued (screening) confirmation never claims delivery
    expect(OFFER_QUEUED_CONFIRMATION.join(' ')).not.toMatch(/\bsent\b|delivered/i);
    // one classifier: confirmations go through offerCopy's businessReplyKind, not their own offer_type checks
    const src = read('utils/actionConfirmations.js');
    expect(src).toMatch(/from '.\/offerCopy'/);
    expect(src).not.toMatch(/offer_type ===/);
    for (const f of ['screens/GatheringConfirmationScreen.js', 'components/InviteFriendsModal.js']) expect(read(f)).toMatch(/inviteSentConfirmation\(/);
    for (const f of ['screens/GatheringDetailScreen.js', 'screens/HomeScreen.js']) expect(read(f)).toMatch(/interestedConfirmation\(/);
    expect(read('screens/AskBusinessScreen.js')).toMatch(/targetPartnerName: targetPartner\?\.name/);
    expect(read('screens/BusinessRequestDetailScreen.js')).toMatch(/justSentLine\(notifiedCount, targetPartnerName\)/);
    // the two moments that already said what happened stay
    expect(read('screens/GatheringConfirmationScreen.js')).toContain("t('ui.gatheringConfirmation.yourGatheringIsLive')");
    expect(require('../i18n/ui/gatheringConfirmation').default.en.yourGatheringIsLive).toBe('Your gathering is live!');
    expect(read('screens/BusinessRequestDetailScreen.js')).toContain("t('ui.requestDetail.youreBooked2')");
    expect(require('../i18n/ui/requestDetail').default.en.youreBooked2).toBe("You're booked. ✓");
  });
  it('no screen confirms with a bare "Success!"', () => {
    const dir = path.join(__dirname, '..');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const offenders = walk(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .filter((f) => /(showSuccessToast|Alert\.alert)\(\s*['"]Success!?['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

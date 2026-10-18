// Owner idea "274" (2026-10-18): a pure success confirmation is the shared self-clearing toast, never a blocking OK-dialog.
// The ten residual dialogs became `showSuccessToast` with their existing words (no new strings, motion or component).
// Three stay dialogs because they explain, not confirm: item 118's changed-offer stop, nobody reached, Welcome to Premium.
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const TOASTS = [
  ['screens/RequestBusinessPartnerScreen.js', 'ui.requestPartner.requestSent', 'ui.requestPartner.willBeNotifiedYoullHear'],
  ['screens/BusinessRequestDetailScreen.js', 'ui.requestDetail.paymentSent', 'ui.requestDetail.yourPaymentIsOnIts'],
  ['components/HostAttendeeManager.js', 'ui.gatheringParts.approved', 'ui.gatheringParts.youCanNowChatWithThem'],
  ['screens/ChatScreen.js', 'ui.chat.updated', null],
  ['components/ReviseOfferSheet.js', 'ui.bizDash3.updatedOfferOnItsWay', null],
  ['screens/BusinessDashboardScreen.js', 'ui.bizDash1.addedToYourProfile', 'ui.bizDash1.theseNowShowUpUnder'],
  ['screens/BusinessDashboardScreen.js', 'ui.bizDash1.submittedForReview', 'ui.bizDash1.yourResponseIsBeingReviewed'],
  ['screens/RelationshipLegacyScreen.js', 'ui.relationshipLegacy.thankYou', 'ui.relationshipLegacy.yourWisdomIsNowPart'],
  ['components/ReportBlockModal.js', 'ui.reportBlock.reportSubmitted', 'ui.reportBlock.thankYouOurTeamWill'],
  ['screens/IdVerificationScreen.js', 'ui.idVerification.submitted', 'ui.idVerification.wellReviewYourSubmissionThis'],
];

const DIALOGS = [
  ['screens/BusinessRequestDetailScreen.js', 'ui.requestDetail.offerUpdated'],
  ['screens/GroupPlanScreen.js', 'ui.requestDetail.offerUpdated'],
  ['screens/BusinessRequestDetailScreen.js', 'ui.requestDetail.added'],
  ['screens/PaywallScreen.js', 'ui.paywallUi.welcomeToPremium'],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('confirm inline, never a success dialog (idea 274)', () => {
  test.each(TOASTS)('%s confirms %s with the shared toast, same words', (file, title, message) => {
    const src = read(file);
    expect(src).toMatch(new RegExp(`showSuccessToast\\(t\\('${esc(title)}'\\)${message ? `, t\\('${esc(message)}'` : ''}`));
    expect(src).not.toMatch(new RegExp(`Alert\\.alert\\(t\\('${esc(title)}'\\)`));
  });

  test.each(DIALOGS)('%s keeps %s as an explaining dialog', (file, title) => {
    expect(read(file)).toMatch(new RegExp(`Alert\\.alert\\(t\\('${esc(title)}'\\)`));
  });

  test('the partner request still returns to the previous screen after its toast', () => {
    expect(read('screens/RequestBusinessPartnerScreen.js')).toMatch(/showSuccessToast\([^;]*\);\s*navigation\.goBack\(\);/);
  });

  test('screens that moved to the toast drop their own success haptic (the toast plays it once)', () => {
    for (const f of ['screens/RelationshipLegacyScreen.js', 'screens/IdVerificationScreen.js']) {
      expect([f, /NotificationFeedbackType\.Success/.test(read(f))]).toEqual([f, false]);
    }
  });
});

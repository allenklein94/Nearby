// Item 110: "Ask a business" from a typed ask carries what the person already said (Home and Discover, one implementation).
// "Coffee for four tonight" -> AskBusiness with Coffee, 4 people and Tonight already filled; everything stays editable and
// nothing is sent until they submit. Only fields the ask really has; the ask as it stands (a chip such as Under $25 included).
// Time stays a day: "tonight" is today's date shown as "Tonight", never an invented clock time.
import { recordIntentSelection } from './intentOutcomes';
import { statedPartySize } from '../utils/askResolver';
import { requestCarriedRows } from '../utils/fromWhatYouSaid';

export function askBusinessParamsFromAsk({ classifyResult, typedText, submissionId }) {
  const c = classifyResult ?? {};
  // "no rush" / "whenever" (item 163) is the person's own answer to When?: "I'm flexible". Nothing else is filled from it.
  const dateWindow = c.dateWindow ?? (c.structured?.spontaneity === 'no_rush' ? 'flexible' : null);
  return {
    prefillText: typedText,
    prefillCategory: c.category ?? null,
    prefillPartySize: c.partySize ?? null,
    prefillBudgetMax: c.budgetMax ?? null,
    prefillDateWindow: dateWindow,
    prefillOccasion: c.occasion ?? null,
    prefillSubmissionId: submissionId ?? null,
    // Owner item 84: opened from an ask -> "From what you said" on top and each missing required field marked before Send.
    prefillFromAsk: true,
    carriedSummary: requestCarriedRows({
      category: c.category ?? null,
      dateWindow,
      statedPartySize: statedPartySize(c.structured ?? { group: { partySize: c.partySize } }, typedText),
    }),
  };
}

export function askBusinessFromAsk(navigation, ask) {
  const c = ask.classifyResult ?? {};
  recordIntentSelection({
    rawText: ask.typedText,
    category: c.category ?? null,
    dateWindow: c.dateWindow ?? null,
    resultType: 'created_new',
    resultId: null,
    resultTitle: ask.typedText,
    submissionId: ask.submissionId,
  });
  navigation.navigate('AskBusiness', askBusinessParamsFromAsk(ask));
}

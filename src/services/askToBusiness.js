// Item 110: "Ask a business" from a typed ask carries what the person already said (Home and Discover, one implementation).
// "Coffee for four tonight" -> AskBusiness with Coffee, 4 people and Tonight already filled; everything stays editable and
// nothing is sent until they submit. Only fields the ask really has; the ask as it stands (a chip such as Under $25 included).
// Time stays a day: "tonight" is today's date shown as "Tonight", never an invented clock time. Owner idea "305" (2026-10-20): a
// clock time the words state ("at 7" = 7 PM, `pointClockFromText`) fills the optional Time field; an ambiguous one ("at 9") stays empty.
import { recordIntentSelection } from './intentOutcomes';
import { understoodPartySize, statedStartMinutes, statedNamedDay } from '../utils/askUnderstood';

const localDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
import { requestCarriedRows } from '../utils/fromWhatYouSaid';
import { namedDayFromText } from '../constants/clockWindow';

export function askBusinessParamsFromAsk({ classifyResult, typedText, submissionId }) {
  const c = classifyResult ?? {};
  // "no rush" / "whenever" (item 163) is the person's own answer to When?: "I'm flexible". Nothing else is filled from it.
  // A When the person removed from the ask's understood chips (owner, 2026-10-15) stays removed here too.
  const whenRemoved = Array.isArray(c.removedUnderstood) && c.removedUnderstood.includes('when');
  const dateWindow = c.dateWindow ?? (!whenRemoved && c.structured?.spontaneity === 'no_rush' ? 'flexible' : null);
  // Idea "306"/"307": a removed clock chip or a changed/removed WHEN carries no time; one switched to AM/PM carries the chosen moment.
  // Owner 2026-10-23: a named weekday ("Saturday", "next Wednesday") is that date, picked (the shared rule, `statedNamedDay`);
  // an exact time already past on it carries neither (the form asks). Tonight / Tomorrow / this weekend keep their own day.
  const ownDay = ['tonight', 'tomorrow', 'today', 'now'].includes(dateWindow);
  const named = ownDay ? null : statedNamedDay(c, typedText);
  const pastOnNamedDay = !ownDay && !named && !whenRemoved && !!namedDayFromText(String(typedText ?? ''));
  const startMinutes = pastOnNamedDay ? null : statedStartMinutes(c, typedText);
  return {
    prefillText: typedText,
    prefillCategory: c.category ?? null,
    prefillPartySize: c.partySize ?? null,
    prefillBudgetMax: c.budgetMax ?? null,
    prefillDateWindow: named ? 'pick_date' : dateWindow,
    // Local noon as UTC keeps the same calendar day in every time zone (the same convention as utils/nightDate.js).
    ...(named ? { prefillPickedDateISO: `${localDateKey(named.date)}T12:00:00.000Z` } : {}),
    prefillStartMinutes: startMinutes,
    prefillOccasion: c.occasion ?? null,
    prefillSubmissionId: submissionId ?? null,
    // Owner item 84: opened from an ask -> "From what you said" on top and each missing required field marked before Send.
    prefillFromAsk: true,
    carriedSummary: requestCarriedRows({
      category: c.category ?? null,
      dateWindow: named ? null : dateWindow, // the picked date shows in the day field itself
      statedPartySize: understoodPartySize(c, typedText),
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

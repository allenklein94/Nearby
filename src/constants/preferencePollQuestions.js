// Item 100 (CLAUDE.md, "Let the recipient contribute preferences without
// spoiling the surprise"), half B: the two fixed, neutral questions a
// preference_polls row can ever carry (question_key_param's own CHECK
// constraint, 20261120_who_for_preference_signals.sql). Deliberately no
// free text -- a hand-typed question could accidentally reveal what's being
// planned, the exact risk this whole feature exists to avoid. Answer option
// vocabularies are the same real, curated lists the migration's own CHECK
// constraints validate against -- reuse CUISINE_OPTIONS/BUSINESS_ATTRIBUTE_
// OPTIONS directly rather than a third copy of either.
import { CUISINE_OPTIONS, VENUE_PREFERENCE_OPTIONS } from './businessAttributes';

export const PREFERENCE_POLL_QUESTIONS = [
  {
    key: 'cuisine_mood',
    label: 'Ask about food',
    questionText: 'What kind of food are you in the mood for lately?',
    options: CUISINE_OPTIONS,
  },
  {
    key: 'venue_vibe',
    label: 'Ask about vibe',
    questionText: "What's your ideal night-out vibe?",
    options: VENUE_PREFERENCE_OPTIONS,
  },
];

export function preferencePollQuestion(key) {
  return PREFERENCE_POLL_QUESTIONS.find((q) => q.key === key) ?? null;
}

export function preferencePollOptionLabel(questionKey, optionKey) {
  const question = preferencePollQuestion(questionKey);
  if (!question) return optionKey;
  const option = question.options.find((o) => o.key === optionKey);
  return option?.label ?? optionKey;
}

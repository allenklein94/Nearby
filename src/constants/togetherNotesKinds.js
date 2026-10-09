// Screen-reduction audit B6 (2026-10-09): five "notes we write together" screens were one interaction (sections, a draft
// per section, moderated insert, realtime list), so they are ONE screen, TogetherNotes, configured by `kind`. Each kind
// keeps its own table, service functions and strings; only the screen is shared. Opened from Chat's "Do Something
// Together" menu with { kind, matchId, matchName }.
import { addSharedDecisionNote, getSharedDecisionNotes } from '../services/sharedDecisions';
import { addTimelineNote, getTimelineNotes } from '../services/timelinePlanner';
import { addStressTestNote, getStressTestNotes } from '../services/stressTest';
import { addConstitutionEntry, getConstitutionEntries } from '../services/relationshipConstitution';
import { addTripIdea, getTripIdeas } from '../services/tripPlanning';

// Each kind: table (realtime), channel prefix, the row's section field + text field, service pair, analytics event + prop,
// success haptic, multiline input, and string builders taking `t` (keys are the ones each old screen used).
export const TOGETHER_NOTES_KINDS = {
  trip: {
    navTitleKey: 'ui.nav.title.tripPlanning',
    table: 'trip_ideas', channel: 'trip-ideas', sectionField: 'category', textField: 'idea_text',
    load: getTripIdeas, add: addTripIdea, event: 'trip_idea_added', eventProp: 'category',
    haptic: false, multiline: false,
    sections: [{ key: 'destination', icon: '📍' }, { key: 'activity', icon: '🎒' }, { key: 'budget', icon: '💰' }],
    title: (t) => t('together.planTrip'),
    subtitle: (t, matchName) => t('ui.tripPlanning.hypotheticallyOfCourseBrainstormWith', { matchName }),
    label: (t, s) => `${s.icon} ${t(`ui.tripPlanning.section.${s.key}`)}`,
    a11ySection: (t, s) => t(`ui.tripPlanning.section.${s.key}`),
    placeholder: (t, s) => t(`ui.tripPlanning.placeholder.${s.key}`),
    addedByA11y: (t, text, name) => t('ui.tripPlanning.addedByA11y', { ideaText: text, name }),
    empty: { emptyCopyId: 'trip_ideas' },
    notAllowed: (t) => [t('ui.tripPlanning.notAllowed'), t('ui.tripPlanning.pleaseReviseThisAndTry')],
    inputA11y: (t, section) => t('ui.tripPlanning.addIdeaA11y', { section }),
    buttonA11y: (t, section) => t('ui.tripPlanning.addIdeaToA11y', { section }),
  },
  bigpicture: {
    navTitleKey: 'ui.nav.title.sharedDecisions',
    table: 'shared_decisions', channel: 'shared-decisions', sectionField: 'category', textField: 'note_text',
    load: getSharedDecisionNotes, add: addSharedDecisionNote, event: 'shared_decision_note_added', eventProp: 'category',
    haptic: false, multiline: false,
    sections: [{ key: 'living', icon: '🏡' }, { key: 'finances', icon: '💵' }, { key: 'family', icon: '👶' }, { key: 'future', icon: '🌅' }],
    title: (t) => t('together.bigPicture'),
    subtitle: (t, matchName) => t('ui.sharedDecisions.notAboutFindingCorrectAnswers', { matchName }),
    label: (t, s) => `${s.icon} ${t(`ui.sharedDecisions.section.${s.key}`)}`,
    a11ySection: (t, s) => t(`ui.sharedDecisions.section.${s.key}`),
    placeholder: (t, s) => t(`ui.sharedDecisions.placeholder.${s.key}`),
    addedByA11y: (t, text, name) => t('ui.sharedDecisions.addedByA11y', { text, name }),
    empty: { emptyCopyId: 'shared_thoughts' },
    notAllowed: (t) => [t('ui.sharedDecisions.notAllowed'), t('ui.sharedDecisions.pleaseReviseThisAndTry')],
    inputA11y: (t, section) => t('ui.sharedDecisions.shareThoughtOnA11y', { section }),
    buttonA11y: (t, section) => t('ui.sharedDecisions.addThoughtToA11y', { section }),
  },
  timeline: {
    navTitleKey: 'ui.nav.title.timelinePlanner',
    table: 'timeline_notes', channel: 'timeline', sectionField: 'period', textField: 'note_text',
    load: getTimelineNotes, add: addTimelineNote, event: 'timeline_note_added', eventProp: 'period',
    haptic: true, multiline: false,
    sections: [{ key: 'month_1', labelKey: 'month1' }, { key: 'month_6', labelKey: 'month6' }, { key: 'year_1', labelKey: 'year1' }, { key: 'year_3', labelKey: 'year3' }],
    title: (t) => t('timeline.title'),
    subtitle: (t) => t('timeline.subtitle'),
    label: (t, s) => t(`timeline.${s.labelKey}`),
    placeholder: (t, s) => t(`ui.matchNotes.timelinePlanner.placeholder.${s.key}`),
    addedByA11y: (t, text, name) => t('ui.matchNotes.addedByA11y', { text, name }),
    empty: { textKey: 'timeline.noThoughtsYet' },
    notAllowed: (t) => [t('ui.matchNotes.notAllowed'), t('ui.matchNotes.pleaseRevise')],
    inputA11y: (t, section) => t('ui.matchNotes.timelinePlanner.addThoughtForA11y', { section }),
    buttonA11y: (t, section) => t('ui.matchNotes.timelinePlanner.addThoughtToA11y', { section }),
  },
  stresstest: {
    navTitleKey: 'ui.nav.title.stressTest',
    table: 'stress_test_notes', channel: 'stress-test', sectionField: 'scenario', textField: 'note_text',
    load: getStressTestNotes, add: addStressTestNote, event: 'stress_test_note_added', eventProp: 'scenario',
    haptic: true, multiline: true,
    sections: [{ key: 'dream_opportunity', labelKey: 'dreamOpportunity' }, { key: 'financial_setback', labelKey: 'financialSetback' }, { key: 'family_conflict', labelKey: 'familyConflict' }, { key: 'lifestyle_difference', labelKey: 'lifestyleDifference' }],
    title: (t) => t('stressTest.title'),
    subtitle: (t) => t('stressTest.subtitle'),
    label: (t, s) => t(`stressTest.${s.labelKey}`),
    placeholder: (t, s) => t(`ui.matchNotes.stressTest.placeholder.${s.key}`),
    addedByA11y: (t, text, name) => t('ui.matchNotes.addedByA11y', { text, name }),
    empty: { textKey: 'timeline.noThoughtsYet' },
    notAllowed: (t) => [t('ui.matchNotes.notAllowed'), t('ui.matchNotes.pleaseRevise')],
    inputA11y: (t, section) => t('ui.matchNotes.stressTest.addThoughtForA11y', { section }),
    buttonA11y: (t, section) => t('ui.matchNotes.stressTest.addThoughtToA11y', { section }),
  },
  constitution: {
    navTitleKey: 'ui.nav.title.relationshipConstitution',
    table: 'constitution_entries', channel: 'constitution', sectionField: 'article', textField: 'entry_text',
    load: getConstitutionEntries, add: addConstitutionEntry, event: 'constitution_entry_added', eventProp: 'article',
    haptic: true, multiline: true,
    sections: [{ key: 'conflict', labelKey: 'conflict' }, { key: 'decisions', labelKey: 'decisions' }, { key: 'support', labelKey: 'support' }, { key: 'never_forget', labelKey: 'neverForget' }, { key: 'feel_loved', labelKey: 'feelLoved' }],
    title: (t) => t('constitution.title'),
    subtitle: (t) => t('constitution.subtitle'),
    label: (t, s) => t(`constitution.${s.labelKey}`),
    placeholder: (t, s) => t(`ui.matchNotes.constitution.placeholder.${s.key}`),
    addedByA11y: (t, text, name) => t('ui.matchNotes.addedByA11y', { text, name }),
    empty: { textKey: 'constitution.nothingWrittenYet' },
    notAllowed: (t) => [t('ui.matchNotes.notAllowed'), t('ui.matchNotes.pleaseRevise')],
    inputA11y: (t, section) => t('ui.matchNotes.constitution.addToA11y', { section }),
    buttonA11y: (t, section) => t('ui.matchNotes.constitution.addEntryToA11y', { section }),
  },
};

// A section label without its leading emoji, for screen readers; letters of every script are kept.
export const stripIcon = (label) => label.replace(/^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[ -⯿️‍])+\s*/, '').trim();

// The section name screen readers hear: the kind's own unadorned section name, else the label minus its emoji.
export function sectionA11yName(kindConfig, t, section) {
  return kindConfig.a11ySection ? kindConfig.a11ySection(t, section) : stripIcon(kindConfig.label(t, section));
}

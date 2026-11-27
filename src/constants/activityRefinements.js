// Optional refinements of an activity Nearby already knows (device test 2026-11-27, item 7). The labels are option
// identities compared by code; what is shown comes from quickOptionLabel (i18n/optionLabels.js) in the person's language.
// Only Dinner has refinements today (the cuisines Start Something always offered). A cuisine is not stored on a gathering
// (no column: "cuisine on gatherings" is a backlog item), so a pick only names the title.
export const NO_PREFERENCE = "Doesn't matter";

export const ACTIVITY_REFINEMENTS = {
  Dinner: [
    { icon: '🍕', label: 'Pizza' },
    { icon: '🌮', label: 'Mexican' },
    { icon: '🍣', label: 'Sushi' },
    { icon: '🍔', label: 'Burgers' },
    { icon: '🥗', label: 'Healthy' },
    { icon: '🍝', label: 'Italian' },
    { icon: '➕', label: NO_PREFERENCE },
  ],
};

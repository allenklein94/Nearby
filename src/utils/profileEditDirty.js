// Item 35 follow-up (owner, 2026-10-08): Edit Profile never throws edits away silently. One comparison decides whether the
// form has unsaved changes, and one guard decides what a leave attempt (header back, Android back, swipe) does.
//
// Only the fields the Save button writes count. Photos, extra photos, the voice intro and the two "hide" switches save the
// moment they are changed, so they are never "unsaved".

const SET_FIELDS = ['interests', 'cuisinePreferences', 'venuePreferences', 'genderIdentity', 'interestedInGenders'];
const TEXT_FIELDS = ['displayName', 'bio', 'pronouns', 'gender', 'sexualOrientation', 'heightFeet', 'heightInchesVal', 'connectionGoal'];

const sortedSet = (v) => [...new Set(Array.isArray(v) ? v : [])].sort();
const text = (v) => (v == null ? '' : String(v));
// A basics answer cleared back to '' is the same as never answered.
const basicsOf = (b) => Object.fromEntries(Object.entries(b || {}).filter(([, v]) => v != null && String(v) !== '').sort(([a], [c]) => (a < c ? -1 : 1)));
const promptsOf = (p) => (Array.isArray(p) ? p : []).map((x) => ({ question: text(x?.question), answer: text(x?.answer) }));

// A stable string for the savable form values: two snapshots are equal exactly when Save would write the same thing
// (sets compared as sets, prompts in order, an emptied basics answer equal to none).
export function profileFormSnapshot(values = {}) {
  const out = {};
  for (const k of TEXT_FIELDS) out[k] = text(values[k]);
  for (const k of SET_FIELDS) out[k] = sortedSet(values[k]);
  out.myEthnicity = values.myEthnicity ?? null;
  out.basics = basicsOf(values.basics);
  out.prompts = promptsOf(values.prompts);
  return JSON.stringify(out);
}

export function isProfileFormDirty(baseline, current) {
  if (baseline == null) return false; // not loaded yet: nothing the person typed can be lost
  return baseline !== current;
}

// What a leave attempt does. Clean (or leaving right after a save) = leave at once. Dirty = stay and ask: "Keep editing"
// leaves everything as typed, "Discard changes" lets the original navigation continue (back to wherever Edit Profile was
// opened from).
export function guardProfileLeave({ dirty, allowLeave, event, confirm, proceed }) {
  if (allowLeave || !dirty) return 'left';
  event.preventDefault();
  confirm({
    onKeepEditing: () => {},
    onDiscard: () => proceed(event.data?.action),
  });
  return 'asked';
}

// Ask only what is needed to move forward (owner item 106, 2026-09-27, LOCKED UX rule). A search never asks anything ("Find me
// coffee" shows options). Only when the person SENDS a request to businesses does Nearby ask for what a business cannot act
// without, one question at a time, and never for something the words or the context already answered:
//   what they want, a category, how many people (solo asks), and what day. Time, budget, vibe, indoor/outdoor, radius stay
//   optional (they already default to real "no preference" answers). "I'm flexible" is a valid day, but the person picks it.
// Exempt from the day question: a gathering's request (its date comes from the gathering) and a request bound to a business's
// live posting (the posting's own window is the day).
// Owner item 84 (2026-10-12): every missing field at once, in the order the fields render, so the form can mark each one where it
// sits before Send. The ONE rule: askMissingField (Send's check) is simply its first entry, so the inline marks and Send never disagree.
export function askMissingFields({ text, category, gatheringId = null, matchId = null, partySize = '', dateWindow = null, matchedAvailability = null }) {
  const out = [];
  if (!String(text ?? '').trim()) out.push({ key: 'text', title: 'Tell us what you want', body: 'A few words about what you’re looking for.' });
  if (!category) out.push({ key: 'category', title: 'Pick a category', body: 'Helps us route this to the right kind of business.' });
  if (!gatheringId && !matchedAvailability && !dateWindow) out.push({ key: 'day', title: 'What day?', body: 'Pick a day, or “I’m flexible” if any day works.' });
  if (!gatheringId && !matchId && !String(partySize ?? '').trim()) out.push({ key: 'party', title: 'How many people?', body: 'A real party size helps a business quote the right offer.' });
  return out;
}

export function askMissingField(form) {
  return askMissingFields(form)[0] ?? null;
}

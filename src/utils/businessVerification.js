// Verified Business admin review rules (owner, 2026-10-31; migration 20270371). The server is the authority (it refuses
// incomplete evidence, stamps who and when, decides verified vs not); this only shapes the admin form so a refusal is rare
// and says the same thing the server would. Methods come from the server (admin_business_verification_methods).
export const VERIFICATION_CHECKS = [
  { key: 'identity', title: '1. Business identity', help: 'The business exists under this name and address.' },
  { key: 'authority', title: '2. Applicant authority', help: 'The person running it on Nearby owns it or may represent it.' },
  { key: 'contact', title: '3. Business-controlled contact', help: 'A phone number or email you found independently (not the one the applicant typed) confirms it.' },
  { key: 'consistency', title: '4. Matches independent records', help: 'What was submitted matches records you looked up yourself.' },
];

export const VERIFICATION_OUTCOMES = [
  { key: 'passed', label: 'Passed' },
  { key: 'failed', label: 'Failed' },
  { key: 'inconclusive', label: 'Inconclusive' },
];

const METHOD_LABELS = {
  state_registry: 'State business registry',
  government_license: 'Government licence record',
  official_website: "The business's official website",
  site_visit: 'Visited in person',
  registry_officer_listing: 'Named as owner/officer in the registry',
  called_official_number: 'Called the number on its official website or listing',
  official_domain_email: "Confirmed from an email at the business's own domain",
  independent_map_listing: 'Independent map listing',
};
export const methodLabel = (m) => METHOD_LABELS[m] ?? m ?? '';

export const NOTE_MIN = 15;
export const DECISION_MIN = 10;

export const emptyReviewDraft = () => ({
  checks: Object.fromEntries(VERIFICATION_CHECKS.map((c) => [c.key, { method: null, outcome: null, note: '' }])),
  decision: '',
});

// The first thing missing, in the order the form shows it; null = ready to send.
export function reviewDraftProblem(draft) {
  for (const c of VERIFICATION_CHECKS) {
    const x = draft?.checks?.[c.key] ?? {};
    if (!x.method) return `${c.title}: pick how you checked it.`;
    if (!x.outcome) return `${c.title}: record the outcome.`;
    if ((x.note ?? '').trim().length < NOTE_MIN) return `${c.title}: write what you found (at least ${NOTE_MIN} characters).`;
  }
  if ((draft?.decision ?? '').trim().length < DECISION_MIN) return `Decision: write it (at least ${DECISION_MIN} characters).`;
  return null;
}

export const reviewDraftChecks = (draft) => Object.fromEntries(VERIFICATION_CHECKS.map((c) => {
  const x = draft.checks[c.key];
  return [c.key, { method: x.method, outcome: x.outcome, note: x.note.trim() }];
}));

const LAPSE = {
  inactive: 'the business is inactive',
  name_changed: 'its name changed since it was verified',
  address_changed: 'its address changed since it was verified',
  manager_changed: 'a different account manages it now',
};

// One line for an admin list row (from admin_list_business_verifications).
export function verificationStateLine(row) {
  if (!row) return '';
  if (row.badge) return '✓ Verified Business (badge showing)';
  if (row.state === 'verified') return `Verified, badge not showing: ${LAPSE[row.lapse] ?? 'details no longer match'}. Record a new review.`;
  if (row.state === 'revoked') return 'Verification revoked. No badge.';
  if (row.state === 'not_verified') return 'Last review did not verify. No badge.';
  return 'Approved, not verified. No badge.';
}

// One business application, one screen (screen-reduction audit 2026-10-24, owner approved item 1): BusinessPartnerApply shows
// whatever state the person's latest application is in. The view decides from the stored row only; the form for a
// "needs info" resend is the Apply form itself, prefilled here, saving only what resubmit_business_partner_request saves.

export const APPLICATION_STATUS_COPY = {
  pending: {
    icon: '⏳',
    title: 'Application Pending',
    body: "We're reviewing your application. We'll let you know as soon as there's an update.",
  },
  approved: {
    icon: '🎉',
    title: "You're a Partner!",
    body: 'Your application was approved. Business Mode is unlocked.',
  },
  denied: {
    icon: '📋',
    title: 'Application Not Approved',
    body: "This application wasn't approved. You're welcome to submit a new one any time.",
  },
  // "Request More Information": same row, real history kept, not a fresh application.
  needs_info: {
    icon: '✍️',
    title: 'One More Thing Needed',
    body: 'Your application is almost there — add the missing info below and resend it.',
  },
};

// 'apply' (no application, or the person chose to start a new one after a decline) | 'pending' | 'approved' | 'denied' | 'needs_info'.
// An unknown stored status reads as pending (never as a blank form that would insert a second application).
export function applicationView(request, { startingNew = false } = {}) {
  if (!request) return 'apply';
  if (request.status === 'denied') return startingNew ? 'apply' : 'denied';
  if (request.status === 'approved' || request.status === 'needs_info') return request.status;
  return 'pending';
}

// The reviewer's note shows only where the person can act on it.
export function showsReviewerNote(view, request) {
  return (view === 'denied' || view === 'needs_info') && !!request?.admin_notes;
}

// The resend form starts from the stored row (the same eight fields resubmit_business_partner_request writes).
export function resendFormFrom(request) {
  return {
    businessName: request?.business_name || '',
    description: request?.business_description || '',
    contactInfo: request?.contact_info || '',
    category: request?.category || null,
    website: request?.website || '',
    phone: request?.phone || '',
    address: request?.address || '',
    requestedFeatures: request?.requested_features || [],
  };
}

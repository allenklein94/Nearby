// Behaviour review cases (20270363): the admin sees what was counted, never message text or a location. One line per
// signal from the case's evidence (admin-only English screen, like the rest of Admin Reports).
const ACTION_NAMES = {
  direct_message: 'messages',
  group_message: 'group chat messages',
  business_message: 'business messages',
  invitation: 'invitations',
  business_request: 'business requests',
  name_change: 'name changes',
  photo_change: 'photo changes',
  commercial_post: 'posts with contact details',
  gathering_create: 'new gatherings',
};

export function behaviorEvidenceLines(evidence) {
  const signals = Array.isArray(evidence?.signals) ? evidence.signals : [];
  return signals.map((sig) => {
    const within = Number.isFinite(sig.window_minutes) ? ` within ${sig.window_minutes} min` : '';
    switch (sig.kind) {
      case 'repeated_messages':
        return `Same message sent to ${sig.recipients} different recipients${within}`;
      case 'join_burst':
        return `Joined ${sig.gatherings} gatherings${within}`;
      case 'location_switching':
        return `Location jumped between ${sig.areas} distant areas${within}`;
      case 'limit_burst': {
        const names = (Array.isArray(sig.actions) ? sig.actions : []).map((a) => ACTION_NAMES[a] || a);
        return `Reached ${names.length} different limits${within}${names.length ? ` (${names.join(', ')})` : ''}`;
      }
      default:
        return null;
    }
  }).filter(Boolean);
}

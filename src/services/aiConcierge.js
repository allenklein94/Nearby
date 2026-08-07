import { supabase } from './supabase';
import { getNearbyGatherings } from './gatherings';
import { getPublicCommunities } from './communities';
import { getActiveOffers } from './brandOffers';

const MAX_CANDIDATES = 40;

// The AI Concierge — a natural-language "find me something tonight" flow.
// The model only ever picks from real, already-fetched candidates and
// writes a short reason per pick; it never sees full descriptions (kept
// client-side for rendering only) and the server re-validates every
// returned id against the real candidate set before this ever runs.
export async function askConcierge(queryText, location) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Sign in to use the Concierge.');

  const [gatherings, communities, offers] = await Promise.all([
    getNearbyGatherings('wide'),
    getPublicCommunities(),
    getActiveOffers(location?.latitude ?? null, location?.longitude ?? null),
  ]);

  const gatheringById = new Map(gatherings.map((g) => [g.id, g]));
  const communityById = new Map(communities.map((c) => [c.id, c]));
  const offerById = new Map((offers ?? []).map((o) => [o.id, o]));

  const candidates = [
    ...gatherings.map((g) => ({
      id: g.id,
      type: 'gathering',
      title: g.title,
      category: g.interest_tag ?? null,
      when: g.scheduled_at ?? null,
      distance: g.distanceLabel ?? null,
    })),
    ...communities.map((c) => ({
      id: c.id,
      type: 'community',
      title: c.name,
      category: null,
      when: null,
      distance: null,
    })),
    ...(offers ?? []).map((o) => ({
      id: o.id,
      type: 'perk',
      title: o.title,
      category: o.target_interest_tag ?? null,
      when: null,
      distance: null,
    })),
  ].slice(0, MAX_CANDIDATES);

  const response = await fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/ai-concierge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: queryText, candidates }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.error || 'The Concierge is unavailable right now.');
  }

  return (result.picks ?? [])
    .map((pick) => {
      const meta =
        pick.id && gatheringById.has(pick.id)
          ? { type: 'gathering', item: gatheringById.get(pick.id) }
          : communityById.has(pick.id)
          ? { type: 'community', item: communityById.get(pick.id) }
          : offerById.has(pick.id)
          ? { type: 'perk', item: offerById.get(pick.id) }
          : null;
      if (!meta) return null;
      return { ...meta.item, conciergeType: meta.type, conciergeReason: pick.reason };
    })
    .filter(Boolean);
}

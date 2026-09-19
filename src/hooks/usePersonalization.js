import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { getMyBehaviorCategories } from '../services/behaviorSignals';
import { getMyTopGatheringCategories } from '../services/gatherings';
import { canonicalizeInterests } from '../constants/interestGraph';
import { behaviorWeightMap } from '../constants/blendedRanking';
import { computeAccountMaturity } from '../constants/signalSourceMaturity';

const ATTENDED_WEIGHT = 3; // a past join counts like a join event

// Everything blended ranking needs, once: declared interests, behavior weights (events + past joins), and the caller's
// real account maturity. Neutral until loaded (no declared, no behavior, maturity null = unchanged behavior).
export default function usePersonalization() {
  const [state, setState] = useState({ declared: [], behavior: {}, maturity: null, socialComfort: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;
        if (!uid) return;
        const [{ data: profile }, events, attended] = await Promise.all([
          supabase.from('profiles').select('interests, created_at, social_comfort_level').eq('id', uid).single(),
          getMyBehaviorCategories().catch(() => []),
          getMyTopGatheringCategories().catch(() => []),
        ]);
        const behavior = behaviorWeightMap(events);
        for (const cat of attended) behavior[cat] = Math.min(12, (behavior[cat] ?? 0) + ATTENDED_WEIGHT);
        const ageDays = profile?.created_at ? (Date.now() - new Date(profile.created_at).getTime()) / 86400000 : null;
        const maturity = computeAccountMaturity({ accountAgeDays: ageDays, hasBehavioralHistory: Object.keys(behavior).length > 0 });
        if (!cancelled) setState({ declared: canonicalizeInterests(profile?.interests), behavior, maturity, socialComfort: profile?.social_comfort_level ?? null });
      } catch {
        // supplementary -- ranking stays neutral
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return state;
}

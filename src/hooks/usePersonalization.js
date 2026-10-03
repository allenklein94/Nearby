import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { getMyBehaviorCategories } from '../services/behaviorSignals';
import { canonicalizeInterests } from '../constants/interestGraph';
import { behaviorWeightMap } from '../constants/blendedRanking';
import { computeAccountMaturity } from '../constants/signalSourceMaturity';
import { getMyLearnedProximity } from '../services/learnedProximity';

// Everything blended ranking needs, once: declared interests, the learned behavior weights (get_my_behavior_categories only:
// item 158 removed a second, all-time join count that bypassed the item-157 evidence bar and Forget/Clear, and counted each
// join twice since joins are already learned events), and the caller's
// real account maturity. Neutral until loaded (no declared, no behavior, maturity null = unchanged behavior).
export default function usePersonalization() {
  const [state, setState] = useState({ declared: [], declaredGroups: [], behavior: {}, maturity: null, socialComfort: null, learnedProximity: {} });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;
        if (!uid) return;
        const [{ data: profile }, events, learnedProximity] = await Promise.all([
          supabase.from('profiles').select('interests, interest_groups, created_at, social_comfort_level').eq('id', uid).single(),
          getMyBehaviorCategories().catch(() => []),
          getMyLearnedProximity().catch(() => ({})), // item 137: usual trip per category (nothing learned = {})
        ]);
        const behavior = behaviorWeightMap(events);
        const ageDays = profile?.created_at ? (Date.now() - new Date(profile.created_at).getTime()) / 86400000 : null;
        const maturity = computeAccountMaturity({ accountAgeDays: ageDays, hasBehavioralHistory: Object.keys(behavior).length > 0 });
        if (!cancelled) setState({ declared: canonicalizeInterests(profile?.interests), declaredGroups: profile?.interest_groups ?? [], behavior, maturity, socialComfort: profile?.social_comfort_level ?? null, learnedProximity });
      } catch {
        // supplementary -- ranking stays neutral
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return state;
}

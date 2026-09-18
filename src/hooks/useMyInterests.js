import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { canonicalizeInterests } from '../constants/interestGraph';

// The signed-in user's declared interests (profiles.interests), canonical tags only. [] until loaded
// or when signed out, so callers can rank unconditionally and simply see no change.
export default function useMyInterests() {
  const [interests, setInterests] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;
        if (!uid) return;
        const { data } = await supabase.from('profiles').select('interests').eq('id', uid).single();
        if (!cancelled) setInterests(canonicalizeInterests(data?.interests));
      } catch {
        // supplementary -- ranking just stays neutral
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return interests;
}

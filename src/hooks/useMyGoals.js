import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { goalShortcuts } from '../constants/onboardingGoals';

// The onboarding goals as Home shortcuts. [] until loaded / signed out / none saved, so Home renders exactly as before.
export default function useMyGoals() {
  const [shortcuts, setShortcuts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;
        if (!uid) return;
        const { data } = await supabase.from('profiles').select('onboarding_motivations').eq('id', uid).single();
        if (!cancelled) setShortcuts(goalShortcuts(data?.onboarding_motivations));
      } catch {
        // supplementary
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return shortcuts;
}

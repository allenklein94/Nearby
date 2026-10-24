import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { startOfferCloseClock } from '../utils/offerCloseClock';

// Owner idea "393": re-renders the request screen at the instant a shown offer stops being acceptable (its valid_until or the
// request's deadline, utils/offerCloseClock.js decides) and once on return to the foreground. Text/state only: no motion.
// `key` = anything that changes when the offers or the request change (the clock re-arms on it).
export default function useOfferCloseClock(offers, ctx, key) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => startOfferCloseClock(offers, ctx, setNowMs, { appState: AppState }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]);
  return nowMs;
}

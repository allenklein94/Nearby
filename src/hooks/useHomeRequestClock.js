import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { startDeadlineClock } from '../utils/offerCloseClock';
import { nextHomeRequestChangeAt } from '../utils/businessHomeRequests';

// Business Home's request preview (utils/businessHomeRequests.js): re-renders at the instant a shown request reaches its
// deadline, and once on return to the foreground. Text only, no motion. Returns the time to read the preview at.
export default function useHomeRequestClock(opportunities, ctx) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => startDeadlineClock((n) => nextHomeRequestChangeAt(opportunities, { ...ctx, now: n }), setNowMs, { appState: AppState }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opportunities, ctx.submissions, ctx.partnerId]);
  return nowMs;
}

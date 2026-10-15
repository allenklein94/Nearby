import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { startMinuteClock, windowsKey } from '../utils/minuteClock';

// Owner item 108: re-renders the screen when a shown relative time label may have changed (utils/minuteClock.js decides
// when); paused in the background. The labels keep reading the time at render (the one engine's default `now`), so a render
// for any other reason is just as fresh; the clock only guarantees one happens. Text only: a consumer never animates on it.
// Only Home and Discover use it (guard: utils/minuteClock.test.js).
export default function useMinuteClock(windows) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const key = windowsKey(windows);
  useEffect(() => startMinuteClock(windows, setNowMs, { appState: AppState }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]);
  return nowMs;
}

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { homeMomentKey } from '../utils/timeContext';
import { startPeriodClock } from '../utils/periodClock';

// Idea "202" follow-up: re-renders Home when its time-of-day period really changed (utils/periodClock.js decides when).
// Runs only while Home is focused and the app is in the foreground; on regaining focus it re-checks once. Text only: a
// consumer never animates on it. Home only (guard: utils/periodClock.test.js).
export default function usePeriodClock() {
  const focused = useIsFocused();
  const [key, setKey] = useState(() => homeMomentKey());
  useEffect(() => {
    if (!focused) return undefined;
    setKey(homeMomentKey()); // same value = no re-render
    return startPeriodClock(setKey, { appState: AppState });
  }, [focused]);
  return key;
}

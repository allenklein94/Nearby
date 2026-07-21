import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightColors, darkColors, getShadow } from '../theme';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'nearby-theme-preference';

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'dark') setIsDark(true);
      setLoaded(true);
    });
  }, []);

  async function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    await AsyncStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
  }

  const colors = isDark ? darkColors : lightColors;
  const shadow = getShadow(isDark);

  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={{ colors, shadow, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
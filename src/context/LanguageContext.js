import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { translations } from '../i18n/translations';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'nearby-language-preference';

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState('en');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'es' || stored === 'en') {
        setLanguageState(stored);
      } else {
        const deviceLang = Localization.getLocales()?.[0]?.languageCode;
        setLanguageState(deviceLang === 'es' ? 'es' : 'en');
      }
      setLoaded(true);
    });
  }, []);

  async function setLanguage(lang) {
    setLanguageState(lang);
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  }

  function t(keyPath) {
    const parts = keyPath.split('.');
    let value = translations[language];
    for (const part of parts) {
      value = value?.[part];
    }
    return value ?? keyPath;
  }

  if (!loaded) return null;

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
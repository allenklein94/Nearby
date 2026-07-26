import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { translations } from '../i18n/translations';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'nearby-language-preference';
const SUPPORTED_LANGUAGES = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru'];

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState('en');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (SUPPORTED_LANGUAGES.includes(stored)) {
        setLanguageState(stored);
      } else {
        const deviceLang = Localization.getLocales()?.[0]?.languageCode;
        setLanguageState(SUPPORTED_LANGUAGES.includes(deviceLang) ? deviceLang : 'en');
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
    if (value === undefined) {
      // Fall back to English if a key is missing in the current
      // language, rather than showing the raw key path to the user.
      let fallback = translations.en;
      for (const part of parts) {
        fallback = fallback?.[part];
      }
      return fallback ?? keyPath;
    }
    return value;
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
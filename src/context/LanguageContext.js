import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { translate, setCurrentLanguage } from '../i18n/translate';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'nearby-language-preference';
const SUPPORTED_LANGUAGES = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState('en');
  const [loaded, setLoaded] = useState(false);
  setCurrentLanguage(language); // keep tr() (code outside components) on the same language as this render

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

  // Missing key in the current language falls back to English, then to the key path (i18n/translate.js). `vars` fills
  // {placeholders}.
  function t(keyPath, vars) {
    return translate(language, keyPath, vars);
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
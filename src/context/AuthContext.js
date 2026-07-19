import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const checkProfile = useCallback(async (currentSession) => {
    if (!currentSession) {
      setProfileComplete(false);
      setIsAdmin(false);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('display_name, birthdate, photo_url, is_admin')
      .eq('id', currentSession.user.id)
      .maybeSingle();

    setProfileComplete(!!(data && data.display_name && data.birthdate && data.photo_url));
    setIsAdmin(!!data?.is_admin);
    setProfileLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      checkProfile(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      checkProfile(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, [checkProfile]);

  return (
    <AuthContext.Provider
      value={{ session, loading, profileComplete, profileLoading, isAdmin, refreshProfile: () => checkProfile(session) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
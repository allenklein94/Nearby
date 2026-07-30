import React, { useState, useCallback } from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';

// A shared header button — a genuine "something's new" dot, not a
// fake always-on badge. Compares real notices and sightings against
// the last time this person actually opened Activity, the same
// honest-timestamp pattern used for Home's "Since you were away."
export default function ActivityBell({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [hasNew, setHasNew] = useState(false);

  useFocusEffect(
    useCallback(() => {
      checkForNew();
    }, [])
  );

  async function checkForNew() {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    if (!myId) return;

    const { data: profile } = await supabase.from('profiles').select('last_activity_check').eq('id', myId).single();
    const lastCheck = profile?.last_activity_check;

    if (!lastCheck) {
      setHasNew(false);
      return;
    }

    const { count } = await supabase
      .from('notices')
      .select('id', { count: 'exact', head: true })
      .eq('to_user', myId)
      .gt('created_at', lastCheck);

    setHasNew((count ?? 0) > 0);
  }

  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Notices')}
      style={styles.button}
      accessibilityLabel={hasNew ? 'Activity, new items' : 'Activity'}
      accessibilityRole="button"
    >
      <Text style={styles.icon}>🔔</Text>
      {hasNew && <View style={styles.dot} />}
    </TouchableOpacity>
  );
}

const getStyles = (colors) => StyleSheet.create({
  button: { paddingHorizontal: 12, position: 'relative' },
  icon: { fontSize: 20 },
  dot: {
    position: 'absolute', top: 4, right: 6, width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.background,
  },
});
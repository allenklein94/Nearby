import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import MatchesScreen from './MatchesScreen';
import ActivityScreen from './ActivityScreen';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// A thin wrapper, not a merge — Messages and Activity stay
// completely separate, already-working screens underneath. This
// just toggles which one renders, avoiding any risk to either
// screen's real, complex internal logic (celebration modal,
// premium gating, compatibility scoring, etc).
export default function InboxScreen(props) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [section, setSection] = useState('messages');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleButton, section === 'messages' && styles.toggleButtonActive]}
          onPress={() => setSection('messages')}
          accessibilityLabel="Messages"
          accessibilityRole="button"
          accessibilityState={{ selected: section === 'messages' }}
        >
          <Text style={[styles.toggleText, section === 'messages' && styles.toggleTextActive]}>💬 Messages</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, section === 'activity' && styles.toggleButtonActive]}
          onPress={() => setSection('activity')}
          accessibilityLabel="Activity"
          accessibilityRole="button"
          accessibilityState={{ selected: section === 'activity' }}
        >
          <Text style={[styles.toggleText, section === 'activity' && styles.toggleTextActive]}>🔔 Activity</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {section === 'messages' ? <MatchesScreen {...props} /> : <ActivityScreen {...props} />}
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toggleRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  toggleButton: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  toggleButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  toggleTextActive: { color: '#fff' },
});
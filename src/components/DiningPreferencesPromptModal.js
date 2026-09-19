import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { CUISINE_OPTIONS, VENUE_PREFERENCE_OPTIONS } from '../constants/businessAttributes';
import { updateMyDiningPreferences } from '../services/preferencePolls';
import { modalAnimation } from '../motion';

// Progressive completion (Preference wiring, Phase 4): shown from Home only to someone who picked a
// food & drink interest and hasn't set tastes yet. Same fields, vocabulary and store as ProfileScreen's
// "Dining & Venue Preferences" (profiles.cuisine_preferences / venue_preferences) -- one store, two
// entry points. Optional; "Not now" is a permanent dismiss handled by the caller.
export default function DiningPreferencesPromptModal({ visible, onClose, onSaved }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [cuisines, setCuisines] = useState([]);
  const [venues, setVenues] = useState([]);
  const [saving, setSaving] = useState(false);

  const toggle = (setter) => (key) => setter((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  async function handleSave() {
    setSaving(true);
    const res = await updateMyDiningPreferences({ cuisinePreferences: cuisines, venuePreferences: venues });
    setSaving(false);
    if (res.success) onSaved?.({ cuisines, venues });
  }

  const chip = (o, selected, onPress, prefix = '') => (
    <TouchableOpacity
      key={o.key}
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={() => onPress(o.key)}
      activeOpacity={0.85}
      accessibilityLabel={o.label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{prefix}{o.label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType={modalAnimation('slide')} transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>What do you like to eat?</Text>
          <Text style={styles.subtitle}>Optional. We'll use it to pick better places, and a friend planning something for you can quietly use it too.</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            <View style={styles.chipWrap}>{CUISINE_OPTIONS.map((o) => chip(o, cuisines.includes(o.key), toggle(setCuisines)))}</View>
            <View style={[styles.chipWrap, { marginTop: spacing.sm }]}>
              {VENUE_PREFERENCE_OPTIONS.map((o) => chip(o, venues.includes(o.key), toggle(setVenues), `${o.icon} `))}
            </View>
          </ScrollView>
          <TouchableOpacity
            style={[styles.saveButton, cuisines.length + venues.length === 0 && { opacity: 0.5 }]}
            onPress={handleSave}
            disabled={saving || cuisines.length + venues.length === 0}
            activeOpacity={0.85}
            accessibilityLabel="Save my tastes"
            accessibilityRole="button"
          >
            <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onClose} accessibilityLabel="Not now" accessibilityRole="button">
            <Text style={styles.cancelButtonText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function getStyles(colors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xl },
    title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
    subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    chipSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
    chipText: { ...typography.caption, color: colors.textPrimary },
    chipTextSelected: { color: colors.primary, fontWeight: '700' },
    saveButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
    saveButtonText: { ...typography.bodyBold, color: '#fff' },
    cancelButton: { paddingVertical: spacing.md, alignItems: 'center' },
    cancelButtonText: { ...typography.caption, color: colors.textTertiary },
  });
}

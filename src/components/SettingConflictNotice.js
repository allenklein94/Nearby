import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// Item 86: a refused contradictory setting, shown right under the control where the owner made the change. The lines are the
// server's exact words (never rewritten here). `onSave` appears only for a save-per-tap row holding an unsaved choice.
export default function SettingConflictNotice({ messages = [], onSave = null, saving = false }) {
  const { colors } = useTheme();
  if (messages.length === 0 && !onSave) return null;
  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      {messages.map((m) => (
        <Text key={m} style={[styles.line, { color: colors.warning }]} accessibilityRole="alert">
          ⚠️ {m}
        </Text>
      ))}
      {onSave ? (
        <View style={styles.row}>
          {messages.length === 0 ? <Text style={[styles.note, { color: colors.textSecondary }]}>Not saved yet.</Text> : null}
          <TouchableOpacity onPress={onSave} disabled={saving} accessibilityRole="button" accessibilityLabel="Save this change">
            <Text style={[styles.save, { color: colors.primary, opacity: saving ? 0.5 : 1 }]}>{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 4 },
  line: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  note: { fontSize: 13 },
  save: { fontSize: 14, fontWeight: '700' },
});

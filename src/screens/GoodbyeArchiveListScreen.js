import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { getMyGoodbyeEntries, deleteGoodbyeEntry } from '../services/goodbyeArchive';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const FIELDS = [
  { key: 'what_was_beautiful', label: '✨ What was beautiful' },
  { key: 'what_was_difficult', label: '💔 What was difficult' },
  { key: 'what_you_learned', label: '🌱 What you learned' },
  { key: 'what_you_want_next_time', label: '🧭 What you want next time' },
];

export default function GoodbyeArchiveListScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const data = await getMyGoodbyeEntries();
    setEntries(data);
    setLoading(false);
  }

  function confirmDelete(entryId) {
    Alert.alert(
      'Delete this reflection?',
      'This is permanent and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteGoodbyeEntry(entryId);
              load();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  }

  function startNewEntry() {
    setNameInput('');
    setNameModalVisible(true);
  }

  function proceedToEntry() {
    if (!nameInput.trim()) {
      return Alert.alert('Add a name', "Who is this reflection about? First name or however you'd like to remember them.");
    }
    setNameModalVisible(false);
    navigation.navigate('GoodbyeArchiveEntry', { aboutDisplayName: nameInput.trim() });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.headerTitle} accessibilityRole="header">🌙 Your Private Reflections</Text>
        <Text style={styles.headerSubtitle}>
          Only visible to you. Every relationship, however it went, becomes something you learned from rather than just something you lost.
        </Text>

        <TouchableOpacity
          style={styles.addButton}
          onPress={startNewEntry}
          activeOpacity={0.85}
          accessibilityLabel="Add a new private reflection"
          accessibilityRole="button"
        >
          <Text style={styles.addButtonText}>+ Add a Reflection</Text>
        </TouchableOpacity>

        {entries.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🌙</Text>
            <Text style={styles.emptyText}>Nothing here yet. Add one any time — after unmatching, you'll also be offered this automatically.</Text>
          </View>
        )}

        {entries.map((entry) => {
          const filledFields = FIELDS.filter((f) => entry[f.key]);
          return (
            <View key={entry.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{entry.about_display_name || 'Someone'}</Text>
                <TouchableOpacity
                  onPress={() => confirmDelete(entry.id)}
                  accessibilityLabel={`Delete reflection about ${entry.about_display_name || 'this person'}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.deleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
              {filledFields.map((f) => (
                <View key={f.key} style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  <Text style={styles.fieldText}>{entry[f.key]}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={nameModalVisible} animationType="slide" transparent onRequestClose={() => setNameModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Who is this about?</Text>
            <TextInput
              style={styles.nameInput}
              placeholder="First name or however you'd like to remember them"
              placeholderTextColor={colors.textTertiary}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              accessibilityLabel="Name"
            />
            <TouchableOpacity
              style={styles.sheetButton}
              onPress={proceedToEntry}
              activeOpacity={0.85}
              accessibilityLabel="Continue"
              accessibilityRole="button"
            >
              <Text style={styles.sheetButtonText}>Continue</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setNameModalVisible(false)}
              style={{ marginTop: spacing.md }}
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  addButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14,
    alignItems: 'center', marginBottom: spacing.lg, ...shadow.button,
  },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  cardTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  deleteText: { color: colors.primary, fontSize: 12, opacity: 0.7 },
  fieldBlock: { marginBottom: spacing.sm },
  fieldLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: 2 },
  fieldText: { ...typography.body, color: colors.textPrimary, lineHeight: 20 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  nameInput: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  sheetButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  sheetButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelText: { color: colors.textTertiary, textAlign: 'center', fontSize: 13 },
});
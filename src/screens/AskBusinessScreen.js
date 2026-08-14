import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { submitBusinessRequest, submitBusinessRequestForGathering } from '../services/businessFulfillment';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Same 24-tag list create-assistant's own VALID_CATEGORIES uses -- the
// exact list business_requests.category's own CHECK constraint validates
// against, so nothing picked here can ever be rejected server-side.
const CATEGORY_OPTIONS = [
  'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
  'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
  'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
  'Volunteering', 'Meditation', 'Running',
];

// Reuses the exact same coarse dateWindow vocabulary as create-assistant's
// Phase 1b extension and intentResolver.js -- never a specific date/time
// the user didn't explicitly pick, matching this app's standing "AI never
// infers a specific date/time" rule (this screen has no AI in it at all,
// but the same discipline applies to keep the whole intent flow honest).
const DATE_OPTIONS = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'weekend', label: 'This weekend' },
  { key: 'flexible', label: "I'm flexible" },
];

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toDateParam(dateWindow) {
  const now = new Date();
  const todayStart = startOfDay(now);
  if (dateWindow === 'today') return todayStart.toISOString().slice(0, 10);
  if (dateWindow === 'tomorrow') {
    const d = new Date(todayStart);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (dateWindow === 'weekend') {
    const dayOfWeek = todayStart.getDay();
    const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
    const d = new Date(todayStart);
    d.setDate(d.getDate() + daysUntilSaturday);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

// Reached two ways: from Home's intent box once Tiers 1/3 (existing
// gatherings/perks) genuinely found nothing -- Tier 4 of the resolver,
// "ask a business to make it happen," framed as a real, first-class path,
// never a fallback after "the real options" failed -- or, when
// `route.params.gatheringId` is present, from a gathering's own host
// banner (Phase 3, "a gathering becomes a demand generator"). In gathering
// mode, party size/date/location are all real data sourced server-side
// from the gathering itself, never re-asked here -- the "When" step is
// skipped entirely since the gathering already has a real date, and party
// size renders as a fact, not an editable field.
export default function AskBusinessScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const gatheringId = route.params?.gatheringId ?? null;
  const gatheringTitle = route.params?.gatheringTitle ?? null;
  const gatheringPartySize = route.params?.gatheringPartySize ?? null;

  const [text, setText] = useState(route.params?.prefillText ?? '');
  const [category, setCategory] = useState(route.params?.prefillCategory ?? null);
  const [partySize, setPartySize] = useState(route.params?.prefillPartySize ? String(route.params.prefillPartySize) : '');
  const [budgetMax, setBudgetMax] = useState(route.params?.prefillBudgetMax ? String(route.params.prefillBudgetMax) : '');
  const [dateWindow, setDateWindow] = useState(route.params?.prefillDateWindow && route.params.prefillDateWindow !== 'flexible' && route.params.prefillDateWindow !== 'now' ? route.params.prefillDateWindow : 'flexible');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!text.trim()) {
      Alert.alert('Tell us what you want', 'A few words about what you’re looking for.');
      return;
    }
    setSubmitting(true);
    try {
      const budgetMaxNum = budgetMax.trim() ? parseInt(budgetMax.trim(), 10) : null;
      const safeBudgetMax = Number.isInteger(budgetMaxNum) && budgetMaxNum > 0 ? budgetMaxNum : null;

      let result;
      if (gatheringId) {
        result = await submitBusinessRequestForGathering({
          gatheringId,
          text: text.trim(),
          category,
          budgetMax: safeBudgetMax,
        });
      } else {
        const partySizeNum = partySize.trim() ? parseInt(partySize.trim(), 10) : null;
        result = await submitBusinessRequest({
          text: text.trim(),
          category,
          partySize: Number.isInteger(partySizeNum) && partySizeNum > 0 ? partySizeNum : null,
          budgetMax: safeBudgetMax,
          date: toDateParam(dateWindow),
        });
      }
      navigation.replace('BusinessRequestDetail', { requestId: result.requestId, justSubmitted: true, notifiedCount: result.notifiedCount });
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    }
    setSubmitting(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.heading}>
            {gatheringId ? `Find ${gatheringTitle ?? 'your gathering'} somewhere to go` : 'Can Nearby make this happen?'}
          </Text>
          <Text style={styles.subtitle}>
            {gatheringId
              ? `Asking on behalf of your ${gatheringPartySize ?? ''}-person gathering — real nearby businesses can respond with a real offer for the group.`
              : "We couldn't find anything already happening for this — real nearby businesses can respond with a real offer."}
          </Text>

          <Text style={styles.label}>What do you want?</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Dinner for 4 tonight, budget around $150…"
            placeholderTextColor={colors.textTertiary}
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel="What do you want?"
          />

          <Text style={styles.label}>Category (optional)</Text>
          <View style={styles.chipRow}>
            {CATEGORY_OPTIONS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, category === c && styles.chipSelected]}
                onPress={() => setCategory(category === c ? null : c)}
                accessibilityLabel={c}
                accessibilityRole="button"
              >
                <Text style={[styles.chipText, category === c && styles.chipTextSelected]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {!gatheringId && (
            <>
              <Text style={styles.label}>When?</Text>
              <View style={styles.chipRow}>
                {DATE_OPTIONS.map((d) => (
                  <TouchableOpacity
                    key={d.key}
                    style={[styles.chip, dateWindow === d.key && styles.chipSelected]}
                    onPress={() => setDateWindow(d.key)}
                    accessibilityLabel={d.label}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.chipText, dateWindow === d.key && styles.chipTextSelected]}>{d.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <View style={styles.row}>
            {!gatheringId && (
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={styles.label}>Party size (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 4"
                  placeholderTextColor={colors.textTertiary}
                  value={partySize}
                  onChangeText={setPartySize}
                  keyboardType="number-pad"
                  accessibilityLabel="Party size"
                />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Budget max (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 150"
                placeholderTextColor={colors.textTertiary}
                value={budgetMax}
                onChangeText={setBudgetMax}
                keyboardType="number-pad"
                accessibilityLabel="Budget max"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, (submitting || !text.trim()) && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={submitting || !text.trim()}
            accessibilityLabel="Ask nearby businesses"
            accessibilityRole="button"
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Ask Nearby Businesses</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  heading: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  label: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.md },
  textArea: {
    ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, minHeight: 90, textAlignVertical: 'top',
  },
  input: {
    ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  row: { flexDirection: 'row' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md, marginRight: spacing.sm, marginBottom: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  submitButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.xl,
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

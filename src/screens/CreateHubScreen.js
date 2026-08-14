import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CREATE_HUB_OPTIONS, SUB_OPTIONS } from '../components/StartSomethingModal';
import { classifyCreateRequest } from '../services/createAssistant';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { iconNameForOption } from '../constants/quickPickIcons';

const SOMETHING_ELSE_LABEL = 'Something Else';

// The real primary Create surface ("Create 2.0") — a big-button icon
// grid inline on the screen, not behind a modal tap. StartSomethingModal's
// CREATE_HUB_OPTIONS/SUB_OPTIONS constants stay the single source of
// truth for the option list (also still used, unmodified, by
// StartSomethingModal itself for HomeScreen's time-adaptive quick
// actions) but are rendered here with this screen's own JSX. Free text
// now lives specifically behind "Something Else" — no more redundant
// always-visible NL box alongside the grid. Community creation moves to
// a small, de-emphasized secondary row below — still a real feature,
// just not what this screen is about anymore. Business consolidation
// (Phase 7, CLAUDE.md) removed this screen's own business entry point —
// "Request a Business Partner" is reachable from a specific gathering/
// community's own detail screen instead, and "become a business owner"
// lives solely on Profile now. See CLAUDE.md's "Create 2.0" and Phase 7
// sections for the full design discussion.
export default function CreateHubScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [activeSubCategory, setActiveSubCategory] = useState(null);
  const [showSomethingElse, setShowSomethingElse] = useState(false);
  const [assistantText, setAssistantText] = useState('');
  const [thinking, setThinking] = useState(false);

  function resetGrid() {
    setActiveSubCategory(null);
    setShowSomethingElse(false);
    setAssistantText('');
  }

  function handlePick(item) {
    if (item.label === SOMETHING_ELSE_LABEL) {
      setShowSomethingElse(true);
      return;
    }
    if (SUB_OPTIONS[item.label]) {
      setActiveSubCategory(item);
      return;
    }
    // A literal icon-grid tap — title/category already known, so the
    // gathering wizard's "What" step is skipped entirely and opens
    // straight to "Who should discover this?".
    navigation.navigate('CreateGathering', {
      quickStartTitle: item.label,
      quickStartCategory: item.category,
      fromQuickPick: true,
    });
  }

  function handlePickSub(subLabel) {
    const title = subLabel === "Doesn't matter" || subLabel === 'Other' ? activeSubCategory.label : subLabel;
    navigation.navigate('CreateGathering', {
      quickStartTitle: title,
      quickStartCategory: activeSubCategory.category,
      fromQuickPick: true,
    });
  }

  async function handleAskAssistant() {
    if (!assistantText.trim()) return;
    setThinking(true);
    try {
      const result = await classifyCreateRequest(assistantText.trim());
      const typedText = assistantText.trim();
      if (result.intent === 'gathering') {
        // An AI guess deserves a look before publish, unlike a literal
        // icon tap — no fromQuickPick here, so the "What" step still
        // shows, prefilled but editable.
        navigation.navigate('CreateGathering', { quickStartTitle: result.title, quickStartCategory: result.category });
      } else if (result.intent === 'community') {
        navigation.navigate('CreateCommunity', { quickStartTitle: result.title, quickStartCategory: result.category });
      } else if (result.intent === 'business_partner') {
        navigation.navigate('RequestBusinessPartner', { initialBusinessQuery: result.businessName ?? '' });
      } else {
        // "unclear" still proceeds into the gathering flow with the
        // typed text as a literal title and no category — the user
        // already told us it's *something* by tapping this tile,
        // rather than a dead-end error.
        navigation.navigate('CreateGathering', { quickStartTitle: typedText, quickStartCategory: null });
      }
      resetGrid();
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    }
    setThinking(false);
  }

  const options = activeSubCategory ? SUB_OPTIONS[activeSubCategory.label] : CREATE_HUB_OPTIONS;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create</Text>
          <Text style={styles.subtitle}>What do you want to create?</Text>

          {(activeSubCategory || showSomethingElse) && (
            <TouchableOpacity onPress={resetGrid} accessibilityLabel="Back" accessibilityRole="button">
              <Text style={styles.backLink}>← Back</Text>
            </TouchableOpacity>
          )}

          {showSomethingElse ? (
            <View style={styles.somethingElseBox}>
              <Text style={styles.somethingElseLabel}>💡 What do you have in mind?</Text>
              <Text style={styles.somethingElseSubtext}>We'll help you turn it into a plan.</Text>
              <View style={styles.assistantRow}>
                <TextInput
                  style={styles.assistantInput}
                  placeholder='e.g. "get some people together for coffee this weekend"'
                  placeholderTextColor={colors.textTertiary}
                  value={assistantText}
                  onChangeText={setAssistantText}
                  onSubmitEditing={handleAskAssistant}
                  returnKeyType="go"
                  autoFocus
                  accessibilityLabel="What do you have in mind?"
                />
                <TouchableOpacity
                  style={styles.assistantButton}
                  onPress={handleAskAssistant}
                  disabled={thinking || !assistantText.trim()}
                  accessibilityLabel="Submit"
                  accessibilityRole="button"
                >
                  {thinking ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.assistantButtonText}>→</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              {activeSubCategory && <Text style={styles.gridHeader}>What kind of {activeSubCategory.label.toLowerCase()}?</Text>}
              <View style={styles.grid}>
                {options.map((item) => (
                  <TouchableOpacity
                    key={item.label}
                    style={styles.gridItem}
                    onPress={() => (activeSubCategory ? handlePickSub(item.label) : handlePick(item))}
                    activeOpacity={0.85}
                    accessibilityLabel={item.label}
                    accessibilityRole="button"
                  >
                    <Ionicons name={iconNameForOption(item)} size={30} color={colors.primary} style={styles.gridItemIcon} />
                    <Text style={styles.gridItemLabel}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {!activeSubCategory && !showSomethingElse && (
            <View style={styles.secondaryRow}>
              <Text style={styles.secondaryRowHeader}>Want to build something bigger?</Text>
              <TouchableOpacity
                style={styles.secondaryLink}
                onPress={() => navigation.navigate('CreateCommunity')}
                accessibilityLabel="Create a community"
                accessibilityRole="button"
              >
                <Text style={styles.secondaryLinkText}>👥 Create a Community</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  backLink: { color: colors.primary, fontWeight: '600', marginBottom: spacing.md },
  gridHeader: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridItem: {
    width: '31%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.lg, alignItems: 'center', ...shadow.card,
  },
  gridItemIcon: { marginBottom: spacing.xs },
  gridItemLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  somethingElseBox: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
  },
  somethingElseLabel: { ...typography.headline, color: colors.textPrimary },
  somethingElseSubtext: { ...typography.caption, color: colors.textTertiary, marginTop: 2, marginBottom: spacing.md },
  assistantRow: { flexDirection: 'row', alignItems: 'center' },
  assistantInput: {
    flex: 1, backgroundColor: colors.background, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, color: colors.textPrimary, ...typography.body, marginRight: spacing.sm,
  },
  assistantButton: {
    backgroundColor: colors.primary, borderRadius: radius.md, width: 48, height: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  assistantButtonText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  secondaryRow: { marginTop: spacing.xl, gap: spacing.sm },
  secondaryRowHeader: { ...typography.caption, color: colors.textTertiary, fontWeight: '600', marginBottom: 2 },
  secondaryLink: { paddingVertical: spacing.sm },
  secondaryLinkText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
});

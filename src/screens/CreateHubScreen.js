import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TabHeaderActions from '../components/TabHeaderActions';
import { classifyCreateRequest } from '../services/createAssistant';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// "I'd call the whole feature 'Occasion' ... I wouldn't clutter Create
// with 10 separate buttons" (direct user request, CLAUDE.md, 2026-09-12):
// replaced the old "big-button icon grid + With people/With businesses/
// For an occasion grouped rows + a second 'bigger' section below" layout
// (which had grown to 3+3+1+1 buttons plus a ~13-tile category grid, all
// competing for the same visual weight) with exactly three primary
// entities you can create in this app -- Gathering, Community, Occasion
// -- as the screen's one clear visual hierarchy, matching the user's own
// mock verbatim (label + one-line tagline each). Every other real action
// this screen used to offer (Invite Friends/Plan a Date/Meet New People/
// Ask Nearby Businesses/Start a Weekly Meetup/Something Else) is kept,
// not deleted -- nothing here was built without a reason, and this user
// didn't ask for any of it to go away, only for the primary view to stop
// looking like 10 buttons -- just demoted into one small "Quick Actions"
// secondary section below the 3 cards, the same demotion precedent this
// screen's own former "Want to build something bigger?" row already
// established. The old activity-category quick-pick grid (Coffee/Dinner/
// Hiking/etc., "fromQuickPick") is the one thing NOT preserved on this
// screen -- CreateGatheringScreen's own "What" step already has a full,
// complete category picker (t('gatherings.categoryLabel')), so that grid
// was always just a shortcut to skip a step that still works fine without
// it; the identical category set is also still available from Home's own
// Quick Picks row (StartSomethingModal.js, a separate, unmodified
// consumer of the same CREATE_HUB_OPTIONS/SUB_OPTIONS constants this
// screen used to import for its own copy of that same grid).
const PRIMARY_CREATE_OPTIONS = [
  { key: 'gathering', icon: 'people-outline', label: 'Gathering', subtitle: 'Bring people together.', route: 'CreateGathering' },
  { key: 'community', icon: 'globe-outline', label: 'Community', subtitle: 'Build something ongoing.', route: 'CreateCommunity' },
  { key: 'occasion', icon: 'sparkles-outline', label: 'Occasion', subtitle: 'Plan a birthday, anniversary, milestone or celebration.', route: 'CelebrateSomething' },
];

// Demoted from three separate grouped rows (With people / With businesses
// / the old "bigger" section) into one flat secondary list -- see the
// header comment above for why. Each of these already routed somewhere
// real before this change; only their visual weight changed.
const QUICK_ACTIONS = [
  { icon: 'person-add-outline', label: 'Invite Friends', route: 'InviteFriends' },
  { icon: 'heart-outline', label: 'Plan a Date', route: 'Messages' },
  { icon: 'people-outline', label: 'Meet New People', route: 'FriendDiscovery' },
  { icon: 'storefront-outline', label: 'Ask Nearby Businesses', route: 'AskBusiness' },
  { icon: 'repeat-outline', label: 'Start a Weekly Meetup', route: 'CreateGathering', params: { quickStartRecurring: true } },
];

export default function CreateHubScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [showSomethingElse, setShowSomethingElse] = useState(false);
  const [assistantText, setAssistantText] = useState('');
  const [thinking, setThinking] = useState(false);

  // Item 61 ("Celebrate Something", CLAUDE.md): the wizard's own "Custom"
  // activity type has no structured destination to route to -- it hands
  // off to this screen's existing AI-classification box instead of
  // building a second one, same "AI suggests, never silently commits"
  // pattern every other prefill here follows (the text is only ever
  // pre-typed, never auto-submitted).
  useEffect(() => {
    if (route.params?.prefillSomethingElseText) {
      setShowSomethingElse(true);
      setAssistantText(route.params.prefillSomethingElseText);
    }
  }, [route.params?.prefillSomethingElseText]);

  function closeSomethingElse() {
    setShowSomethingElse(false);
    setAssistantText('');
  }

  function handleQuickAction(action) {
    navigation.navigate(action.route, action.params);
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
        // Item 38 ("don't force the user to know the app's terminology"):
        // "unclear" used to fall through to CreateGathering with the raw
        // typed text as a literal title -- so "Can someone find me a good
        // place for dinner?" (a real, valid ask that correctly classifies
        // as "unclear" since it doesn't describe hosting or starting
        // anything) got force-fit into "you're creating a gathering called
        // 'Can someone find me a good place for dinner?'", a nonsensical
        // object for what the user actually asked for. create-assistant's
        // own prompt now extracts category/partySize/dateWindow/budgetMax/
        // occasion regardless of intent specifically so this branch can
        // route to the real matching product object instead: Ask Nearby
        // Businesses (AskBusinessScreen), the same "post what you need,
        // businesses respond" flow this screen's own Quick Actions row
        // already offers -- prefilled exactly the same way HomeScreen's own
        // goAskBusiness()/business_availability branches already prefill it
        // from an identical classifyResult shape. Still just a prefill: the
        // user reviews/edits every field before anything is ever submitted.
        navigation.navigate('AskBusiness', {
          prefillText: typedText,
          prefillCategory: result.category ?? null,
          prefillPartySize: result.partySize ?? null,
          prefillBudgetMax: result.budgetMax ?? null,
          prefillDateWindow: result.dateWindow ?? null,
          prefillOccasion: result.occasion ?? null,
        });
      }
      closeSomethingElse();
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    }
    setThinking(false);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Create</Text>
              <Text style={styles.subtitle}>Make Something Happen</Text>
            </View>
            <TabHeaderActions navigation={navigation} />
          </View>

          {/* Aug 24 2026: Discover is a real bottom tab again (see
              CLAUDE.md) -- this stays as a real, harmless secondary
              shortcut straight into its Things-to-Do mode, not the only
              way to reach it anymore. */}
          {!showSomethingElse && (
            <TouchableOpacity
              style={styles.browseLink}
              onPress={() => navigation.navigate('Discover')}
              accessibilityLabel="Browse gatherings, communities, places, and perks"
              accessibilityRole="button"
            >
              <Text style={styles.browseLinkText}>🔎 Browse what's already out there</Text>
              <Text style={styles.browseLinkChevron}>›</Text>
            </TouchableOpacity>
          )}

          {showSomethingElse && (
            <TouchableOpacity onPress={closeSomethingElse} accessibilityLabel="Back" accessibilityRole="button">
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
              {thinking && <Text style={styles.somethingElseSubtext}>Building your options…</Text>}
            </View>
          ) : (
            <>
              {/* "I'd call the whole feature 'Occasion' ... I wouldn't
                  clutter Create with 10 separate buttons" (CLAUDE.md,
                  direct user request) -- the one visual hierarchy this
                  screen now has: the three real things you can create. */}
              <View style={styles.primaryCards}>
                {PRIMARY_CREATE_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.key}
                    style={styles.primaryCard}
                    onPress={() => navigation.navigate(opt.route)}
                    activeOpacity={0.85}
                    accessibilityLabel={opt.label}
                    accessibilityRole="button"
                  >
                    <View style={styles.primaryCardIconWrap}>
                      <Ionicons name={opt.icon} size={24} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.primaryCardLabel}>{opt.label}</Text>
                      <Text style={styles.primaryCardSubtitle}>{opt.subtitle}</Text>
                    </View>
                    <Text style={styles.primaryCardChevron}>›</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.secondaryRowHeader}>Quick Actions</Text>
              <View style={styles.quickActionsList}>
                {QUICK_ACTIONS.map((action) => (
                  <TouchableOpacity
                    key={action.label}
                    style={styles.quickActionRow}
                    onPress={() => handleQuickAction(action)}
                    accessibilityLabel={action.label}
                    accessibilityRole="button"
                  >
                    <Ionicons name={action.icon} size={18} color={colors.textSecondary} />
                    <Text style={styles.quickActionLabel}>{action.label}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.quickActionRow}
                  onPress={() => setShowSomethingElse(true)}
                  accessibilityLabel="Something Else"
                  accessibilityRole="button"
                >
                  <Ionicons name="bulb-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.quickActionLabel}>Something Else</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  backLink: { color: colors.primary, fontWeight: '600', marginBottom: spacing.md },
  browseLink: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  browseLinkText: { ...typography.body, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  browseLinkChevron: { color: colors.textTertiary, fontSize: 22 },
  // The one visual hierarchy this screen now has -- three roomy, co-equal
  // primary cards (Gathering/Community/Occasion), each with its own icon,
  // label, and one-line tagline, per the user's own mock verbatim. Same
  // bordered-surface + shadow.card treatment this file's old peopleAction
  // cards used, just bigger and full-width since there are only three.
  primaryCards: { gap: spacing.sm, marginBottom: spacing.xl },
  primaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, ...shadow.card,
  },
  primaryCardIconWrap: {
    width: 44, height: 44, borderRadius: radius.md, backgroundColor: `${colors.primary}1a`,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryCardLabel: { ...typography.headline, color: colors.textPrimary },
  primaryCardSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  primaryCardChevron: { color: colors.textTertiary, fontSize: 22 },
  // Every other real action this screen offers, demoted to one small flat
  // list below the 3 primary cards -- see this file's own header comment
  // for why these were kept rather than deleted.
  quickActionsList: { gap: 2 },
  quickActionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  quickActionLabel: { ...typography.body, color: colors.textSecondary, fontWeight: '600', fontSize: 14 },
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
  secondaryRowHeader: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
});

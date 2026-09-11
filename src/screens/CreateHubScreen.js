import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, ImageBackground } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CREATE_HUB_OPTIONS, SUB_OPTIONS } from '../components/StartSomethingModal';
import TabHeaderActions from '../components/TabHeaderActions';
import { classifyCreateRequest } from '../services/createAssistant';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { iconNameForOption } from '../constants/quickPickIcons';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { curatedCoverPhotoFor } from '../constants/gatheringCoverPhotos';

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
//
// "With People" quick-action row, added per the Aug 23 2026 IA pass
// (CLAUDE.md): a real, deliberate reason this screen's own grid now
// leads with three action verbs (Invite Friends / Plan a Date / Meet
// New People) before the activity-category grid — the grid alone read
// as a near-duplicate of Home's own time-of-day Quick Picks chip row
// (same category set, Coffee/Dinner/Walk/etc.), so tapping into Create
// felt like Home opened again in another place. These three rows are
// deliberately not shaped like that: none of them create a gathering
// directly, each routes to a real, already-working destination
// (InviteFriends/Messages.../FriendDiscovery) — Create's own job stays
// "turn an idea into an action," distinct from Home's "here's what's
// nearby right now."
const WITH_PEOPLE_ACTIONS = [
  { icon: 'person-add-outline', label: 'Invite Friends', subtitle: 'Bring someone new to Nearby', route: 'InviteFriends' },
  { icon: 'heart-outline', label: 'Plan a Date', subtitle: 'Turn a match into a real plan', route: 'Messages' },
  { icon: 'people-outline', label: 'Meet New People', subtitle: 'Make new friends nearby', route: 'FriendDiscovery' },
];

// Thursday plan item 20 ("Create should be the inverse of Discover"): the
// user's own named list of Create actions included "Ask Businesses"
// alongside Create a Gathering/Build a Community -- and this screen really
// had no path to it. AskBusinessScreen (the real "post a request, any
// business can respond" flow -- distinct from the Phase 7 "Request a
// Business Partner" affiliate flow that was deliberately removed from
// here) was only ever reachable *from* an existing gathering/community/
// match/Home-ask context, never as its own top-level "make something
// happen" action the way Create a Gathering already is. Navigated with no
// params -- a genuinely blank ask, same as every route.params?. fallback
// AskBusinessScreen.js already has; there's no prior typed-ask context to
// prefill from here the way HomeScreen's own entry points have.

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
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Create</Text>
              <Text style={styles.subtitle}>What do you want to create?</Text>
            </View>
            <TabHeaderActions navigation={navigation} />
          </View>

          {/* Aug 24 2026: Discover is a real bottom tab again (see
              CLAUDE.md) -- this stays as a real, harmless secondary
              shortcut straight into its Things-to-Do mode, not the only
              way to reach it anymore. */}
          {!activeSubCategory && !showSomethingElse && (
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

          {(activeSubCategory || showSomethingElse) && (
            <TouchableOpacity onPress={resetGrid} accessibilityLabel="Back" accessibilityRole="button">
              <Text style={styles.backLink}>← Back</Text>
            </TouchableOpacity>
          )}

          {!activeSubCategory && !showSomethingElse && (
            <>
              <Text style={styles.groupHeader}>With people</Text>
              <View style={styles.peopleActionsRow}>
                {WITH_PEOPLE_ACTIONS.map((action) => (
                  <TouchableOpacity
                    key={action.label}
                    style={styles.peopleAction}
                    onPress={() => navigation.navigate(action.route)}
                    activeOpacity={0.85}
                    accessibilityLabel={action.label}
                    accessibilityRole="button"
                  >
                    <Ionicons name={action.icon} size={22} color={colors.primary} />
                    <Text style={styles.peopleActionLabel}>{action.label}</Text>
                    <Text style={styles.peopleActionSubtitle}>{action.subtitle}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.groupHeader}>With businesses</Text>
              <TouchableOpacity
                style={styles.peopleAction}
                onPress={() => navigation.navigate('AskBusiness')}
                activeOpacity={0.85}
                accessibilityLabel="Ask Nearby Businesses"
                accessibilityRole="button"
              >
                <Ionicons name="storefront-outline" size={22} color={colors.primary} />
                <Text style={styles.peopleActionLabel}>Ask Nearby Businesses</Text>
                <Text style={styles.peopleActionSubtitle}>Post what you need, businesses respond</Text>
              </TouchableOpacity>

              <Text style={styles.groupHeader}>Something to do</Text>
            </>
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
              {activeSubCategory && <Text style={styles.gridHeader}>What kind of {activeSubCategory.label.toLowerCase()}?</Text>}
              <View style={styles.grid}>
                {options.map((item) => {
                  // Real curated category photo (same map GatheringDetailScreen/
                  // GatheringsScreen already use as their cover-photo fallback)
                  // wins whenever one exists -- a "Coffee" tile shows real
                  // coffee, not just a tinted swatch. categoryStyleFor()'s
                  // color still backs the tint fallback for categories with
                  // no sourced photo (never a fabricated color). Items with
                  // no real category (Something Else, and the Dinner
                  // sub-grid's cuisine leaves) fall back to the neutral
                  // surfaceElevated token instead of reusing an unrelated
                  // category's color/photo.
                  const categoryColor = item.category ? categoryStyleFor(item.category).color : null;
                  const photoUrl = item.category ? curatedCoverPhotoFor(item.category) : null;
                  return (
                    <TouchableOpacity
                      key={item.label}
                      style={[
                        styles.gridItem,
                        !photoUrl && (categoryColor ? { backgroundColor: `${categoryColor}20` } : { backgroundColor: colors.surfaceElevated }),
                      ]}
                      onPress={() => (activeSubCategory ? handlePickSub(item.label) : handlePick(item))}
                      activeOpacity={0.85}
                      accessibilityLabel={item.label}
                      accessibilityRole="button"
                    >
                      {photoUrl ? (
                        <ImageBackground source={{ uri: photoUrl }} style={styles.gridItemPhoto}>
                          <View style={styles.gridItemPhotoScrim}>
                            <Ionicons name={iconNameForOption(item)} size={28} color="#fff" style={styles.gridItemIcon} />
                            <Text style={[styles.gridItemLabel, styles.gridItemLabelOnPhoto]}>{item.label}</Text>
                          </View>
                        </ImageBackground>
                      ) : (
                        <>
                          <Ionicons name={iconNameForOption(item)} size={30} color={categoryColor ?? colors.textSecondary} style={styles.gridItemIcon} />
                          <Text style={styles.gridItemLabel}>{item.label}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  );
                })}
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
              {/* A real, distinct entry point (not a rename of the one above):
                  this creates a recurring gathering (gatherings.recurring_series_id),
                  never a communities row -- deliberately not labeled "Start a
                  Community" so it can't be mistaken for the button right above
                  it, which creates a genuinely different entity. */}
              <TouchableOpacity
                style={styles.secondaryLink}
                onPress={() => navigation.navigate('CreateGathering', { quickStartRecurring: true })}
                accessibilityLabel="Start a weekly meetup"
                accessibilityRole="button"
              >
                <Text style={styles.secondaryLinkText}>🔁 Start a Weekly Meetup</Text>
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
  groupHeader: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.sm },
  peopleActionsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  peopleAction: {
    flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, gap: 2,
  },
  peopleActionLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginTop: spacing.xs },
  peopleActionSubtitle: { ...typography.caption, color: colors.textTertiary, fontSize: 11 },
  gridHeader: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridItem: {
    width: '31%', aspectRatio: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...shadow.card,
  },
  gridItemPhoto: { width: '100%', height: '100%' },
  gridItemPhotoScrim: {
    flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)',
  },
  gridItemIcon: { marginBottom: spacing.xs },
  gridItemLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  gridItemLabelOnPhoto: { color: '#fff' },
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

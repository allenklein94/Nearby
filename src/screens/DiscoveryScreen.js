import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Feather } from '@expo/vector-icons';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, Alert, Animated, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getNearbyMatches, getBrowseMatches, reportPresence } from '../services/proximity';
import { checkAndCountBrowseView } from '../services/browseLimits';
import { getOnlineStatuses } from '../services/presenceStatus';
import { generateCompatibilityReport } from '../services/compatibility';
import { shouldOfferBreak, dismissBreakSuggestion } from '../services/confidenceMode';
import { isPremium } from '../services/purchases';
import { checkNoticeLimit, checkWaveLimit } from '../services/noticeLimits';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { INTENTION_OPTIONS } from '../constants/intentionOptions';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { ETHNICITY_OPTIONS } from '../constants/ethnicityOptions';
import ReportBlockModal from '../components/ReportBlockModal';
import CompatibilityReportModal from '../components/CompatibilityReportModal';
import DatingPreferencesPromptModal from '../components/DatingPreferencesPromptModal';
import ConfidenceModeBanner from '../components/ConfidenceModeBanner';
import FiltersModal from '../components/FiltersModal';
import SkeletonCard from '../components/SkeletonCard';
import AnimatedListItem from '../components/AnimatedListItem';
import SwipeableDiscoveryCards from '../components/SwipeableDiscoveryCards';
import SightingMapModal from '../components/SightingMapModal';
import SightingsOverviewMap from '../components/SightingsOverviewMap';
import ScaleButton from '../components/ScaleButton';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const UNDO_WINDOW_SECONDS = 5;

const DISCOVERY_FILTER_FIELDS = [
  ...BASICS_FIELDS.filter((f) => f.type === 'select'),
  { key: 'ethnicity', label: 'Ethnicity', icon: '🌍', options: ETHNICITY_OPTIONS, topLevel: true },
];

function formatCrossedPathsTime(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const dateTimeStamp = then.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ', ' + then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  let relative;
  if (diffMins < 1) relative = 'Just now';
  else if (diffMins < 60) relative = `${diffMins} min${diffMins === 1 ? '' : 's'} ago`;
  else if (diffHours < 24) relative = `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  else if (diffDays === 1) relative = 'Yesterday';
  else if (diffDays < 7) relative = `${diffDays} days ago`;
  else relative = null;

  return relative ? `${relative} (${dateTimeStamp})` : dateTimeStamp;
}

function calculateAge(birthdateString) {
  if (!birthdateString) return null;
  const birthdate = new Date(birthdateString);
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const monthDiff = today.getMonth() - birthdate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
    age--;
  }
  return age;
}

// Aug 24 2026 (CLAUDE.md): an optional `embedded` prop lets this screen be
// mounted directly inside Discover's People mode -- the exact same
// "embed the real screen, no navigation, no rebuild" pattern MatchesScreen/
// FriendsScreen are already embedded with inside MessagesScreen's own
// Matches|Friends toggle. When embedded, the outer SafeAreaView is skipped
// (the host screen already provides one) and the redundant big title Text
// is hidden -- the segmented Dating|Friends toggle one level up already
// names this surface, so repeating "Nearby"/"Browse" underneath it would
// just be noise. Everything else (the info/view-toggle/map buttons, the
// Crossed Paths/Browse switcher, filters, the list/card deck) is unchanged.
export default function DiscoveryScreen({ navigation, embedded = false }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const Container = embedded ? View : SafeAreaView;
  const posthog = usePostHog();
  const [nearby, setNearby] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [reportTarget, setReportTarget] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [onlineStatuses, setOnlineStatuses] = useState({});
  const [undoState, setUndoState] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [isUserPremium, setIsUserPremium] = useState(false);
  const [compatModalReport, setCompatModalReport] = useState(null);
  const [compatModalName, setCompatModalName] = useState('');
  const [confidenceBannerReason, setConfidenceBannerReason] = useState(null);
  const [intentionFilter, setIntentionFilter] = useState([]);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [highCompatOnly, setHighCompatOnly] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [filtersModalVisible, setFiltersModalVisible] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState({});
  const [ageRangeFilter, setAgeRangeFilter] = useState({ min: 18, max: 99 });
  const [viewStyle, setViewStyle] = useState('list');
  const [discoveryMode, setDiscoveryMode] = useState('crossedPaths');
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browseHasMore, setBrowseHasMore] = useState(true);
  const [loadingMoreBrowse, setLoadingMoreBrowse] = useState(false);
  const [sightingMapTarget, setSightingMapTarget] = useState(null);
  const [showSightingsOverview, setShowSightingsOverview] = useState(false);
  const [showDatingPrefsPrompt, setShowDatingPrefsPrompt] = useState(false);
  const [quickFilterOrder, setQuickFilterOrder] = useState(['verified', 'highCompat', 'online']);
  const [quickFilterVisible, setQuickFilterVisible] = useState(['verified', 'highCompat', 'online']);
  const undoTimeoutRef = useRef(null);
  const undoOpacity = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    await reportPresence();
    const results = await getNearbyMatches();
    setNearby(results);
    setInitialLoading(false);

    const urlEntries = await Promise.all(
      results.map(async (item) => {
        const path = item.profiles?.photo_url;
        if (!path) return [item.id, null];
        const url = await getSignedPhotoUrl(path);
        return [item.id, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));

    const otherUserIds = results.map((item) => item.otherUserId);
    const statuses = await getOnlineStatuses(otherUserIds);
    setOnlineStatuses(statuses);

    isPremium().then(setIsUserPremium).catch(() => setIsUserPremium(false));

    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    setMyUserId(myId);
    if (myId) {
      const { data: mine } = await supabase.from('profiles').select('interests, basics, discovery_view_style, quick_filter_order, quick_filter_visible, discovery_gender, show_me, preferred_min_age, preferred_max_age, relationship_intention, dating_preferences_set, gender_identity, interested_in_genders').eq('id', myId).single();
      if (mine?.quick_filter_order) setQuickFilterOrder(mine.quick_filter_order);
      if (mine?.quick_filter_visible) setQuickFilterVisible(mine.quick_filter_visible);
      setMyProfile(mine);
      setViewStyle(mine?.discovery_view_style ?? 'list');

      const reason = await shouldOfferBreak(myId);
      setConfidenceBannerReason(reason);

      // Phase 3 (progressive/contextual settings, see CLAUDE.md): the
      // real first-open gate -- a genuinely unset profile, not just
      // "still at the default value" (discovery_gender/show_me/age range
      // all have real non-null defaults, so a bare null check would never
      // fire). Shown once, same "flip a flag, never again" shape as the
      // browse callout right above it.
      if (mine && !mine.dating_preferences_set) {
        setShowDatingPrefsPrompt(true);
      }
    }
  }, []);

  const loadBrowseBatch = useCallback(async (offset) => {
    const results = await getBrowseMatches(offset);

    if (myUserId) {
      const limitCheck = await checkAndCountBrowseView(myUserId, results.length);
      if (!limitCheck.allowed) {
        setBrowseHasMore(false);
        Alert.alert(
          'Daily limit reached',
          limitCheck.reason,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Upgrade to Premium', onPress: () => navigation.navigate('Paywall') },
          ]
        );
        return;
      }
    }

    setBrowseHasMore(results.length > 0);

    const urlEntries = await Promise.all(
      results.map(async (item) => {
        const path = item.profiles?.photo_url;
        if (!path) return [item.id, null];
        const url = await getSignedPhotoUrl(path);
        return [item.id, url];
      })
    );
    setPhotoUrls((prev) => ({ ...prev, ...Object.fromEntries(urlEntries) }));

    if (offset === 0) {
      setNearby(results);
    } else {
      setNearby((prev) => [...prev, ...results]);
    }
  }, [myUserId, isUserPremium]);

  async function switchDiscoveryMode(mode) {
    if (mode === discoveryMode) return;
    setDiscoveryMode(mode);
    setNearby([]);
    setBrowseOffset(0);
    setBrowseHasMore(true);
    setInitialLoading(true);
    if (mode === 'browse') {
      await loadBrowseBatch(0);
      setInitialLoading(false);
    } else {
      await load();
    }
  }

  async function loadMoreBrowse() {
    if (loadingMoreBrowse || !browseHasMore) return;
    setLoadingMoreBrowse(true);
    const nextOffset = browseOffset + 20;
    await loadBrowseBatch(nextOffset);
    setBrowseOffset(nextOffset);
    setLoadingMoreBrowse(false);
  }

  useFocusEffect(
    useCallback(() => {
      if (discoveryMode === 'crossedPaths') load();
    }, [load, discoveryMode])
  );

  async function handleDismissConfidenceBanner() {
    setConfidenceBannerReason(null);
    if (myUserId) await dismissBreakSuggestion(myUserId);
  }

  function showRadiusInfo() {
    if (discoveryMode === 'browse') {
      Alert.alert(
        'How Browse Works',
        "Browse shows a wider pool of people matching your filters — not limited to actual proximity like Crossed Paths. Great for exploring beyond who you've recently been near.\n\n👋 Notice vs Wave:\nA Notice is silent — they only find out if they notice you back too. A Wave tells them right away that you noticed them, before it\u2019s mutual.",
        [{ text: 'OK' }]
      );
      return;
    }
    Alert.alert(
      t('discovery.radiusInfoTitle'),
      t('discovery.radiusInfoText') + '\n\n👋 Notice vs Wave:\nA Notice is silent — they only find out if they notice you back too. A Wave tells them right away that you noticed them, before it\u2019s mutual.',
      [{ text: 'OK' }]
    );
  }

  function showCompatibilityReport(item) {
    const report = generateCompatibilityReport(myProfile, item.profiles);
    setCompatModalReport(report);
    setCompatModalName(item.profiles?.display_name || '');
  }

  // Aug 30 2026 (CLAUDE.md, external UX critique response): used to
  // premium-gate opening the modal at all -- Looking For and Quick
  // Filters were never actually premium features, so a free user
  // couldn't reach them from here even though they're free everywhere
  // else. The modal itself now gates only its own Advanced Filters
  // section (isPremium prop below), so this always opens.
  function openFilters() {
    setFiltersModalVisible(true);
  }

  async function toggleViewStyle() {
    const newStyle = viewStyle === 'cards' ? 'list' : 'cards';
    setViewStyle(newStyle);
    if (myUserId) {
      await supabase.from('profiles').update({ discovery_view_style: newStyle }).eq('id', myUserId);
    }
  }

  function showUndoBanner(noticeId, isWave, otherUserId) {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoState({ noticeId, isWave, otherUserId });
    Animated.timing(undoOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();

    undoTimeoutRef.current = setTimeout(() => {
      Animated.timing(undoOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setUndoState(null);
      });
    }, UNDO_WINDOW_SECONDS * 1000);
  }

  async function handleUndo() {
    if (!undoState) return;
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);

    await supabase.from('notices').delete().eq('id', undoState.noticeId);

    if (myUserId && undoState.otherUserId) {
      await supabase
        .from('matches')
        .delete()
        .or(`and(user_a.eq.${myUserId},user_b.eq.${undoState.otherUserId}),and(user_a.eq.${undoState.otherUserId},user_b.eq.${myUserId})`);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    Animated.timing(undoOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setUndoState(null);
    });
    load();
  }

  async function sendNotice(toUserId, isWave = false) {
    const limitCheck = isWave ? await checkWaveLimit() : await checkNoticeLimit();
    if (!limitCheck.allowed) {
      Alert.alert(
        isWave ? 'Weekly Wave used' : 'Daily limit reached',
        limitCheck.reason,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Upgrade to Premium', onPress: () => navigation.navigate('Paywall') },
        ]
      );
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { data: sessionData } = await supabase.auth.getSession();
    const fromUserId = sessionData?.session?.user?.id;

    const { data: inserted, error: insertError } = await supabase
      .from('notices')
      .insert({ from_user: fromUserId, to_user: toUserId, is_super: isWave })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: existing } = await supabase
          .from('notices')
          .select('id, is_super')
          .eq('from_user', fromUserId)
          .eq('to_user', toUserId)
          .maybeSingle();

        if (existing && isWave && !existing.is_super) {
          const { error: updateError } = await supabase
            .from('notices')
            .update({ is_super: true })
            .eq('id', existing.id);

          if (updateError) {
            Alert.alert('Wave not sent', updateError.message);
            return;
          }
          posthog.capture('wave_sent');
          showUndoBanner(existing.id, true, toUserId);
          return;
        }

        Alert.alert('Already sent', "You've already noticed this person.");
        return;
      }

      Alert.alert(isWave ? 'Wave not sent' : 'Notice not sent', insertError.message);
      return;
    }

    posthog.capture(isWave ? 'wave_sent' : 'notice_sent');
    showUndoBanner(inserted.id, isWave, toUserId);
  }

  function confirmWave(toUserId) {
    Alert.alert(
      'Send a Wave? 👋',
      "Unlike a regular Notice, they'll be told right away that you noticed them — before it's mutual. Free users get 1 per week.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send Wave', onPress: () => sendNotice(toUserId, true) },
      ]
    );
  }

  function handleCardNotice(toUserId) {
    sendNotice(toUserId, false);
  }

  function handleCardWave(toUserId) {
    confirmWave(toUserId);
  }

  async function onRefresh() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function compatibilityColor(score) {
    if (score >= 70) return colors.success;
    if (score >= 40) return colors.primary;
    return colors.textTertiary;
  }

  const advancedFilterCount = Object.values(advancedFilters).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);
  const ageFilterActive = ageRangeFilter.min !== 18 || ageRangeFilter.max !== 99;
  const totalActiveCount = advancedFilterCount + (ageFilterActive ? 1 : 0);
  const anyFilterActive = intentionFilter.length > 0 || verifiedOnly || highCompatOnly || onlineOnly || totalActiveCount > 0;
  const activeQuickCount = [verifiedOnly, highCompatOnly, onlineOnly].filter(Boolean).length;

  const filteredNearby = nearby.filter((item) => {
    if (verifiedOnly && !item.profiles?.photo_verified) return false;
    if (highCompatOnly && (item.compatibilityScore === null || item.compatibilityScore < 70)) return false;
    if (onlineOnly && !onlineStatuses[item.otherUserId]) return false;
    if (intentionFilter.length > 0) {
      const intentions = Array.isArray(item.profiles?.relationship_intention) ? item.profiles.relationship_intention : [];
      if (!intentionFilter.some((f) => intentions.includes(f))) return false;
    }
    if (isUserPremium && ageFilterActive) {
      const age = calculateAge(item.profiles?.birthdate);
      if (age !== null && (age < ageRangeFilter.min || age > ageRangeFilter.max)) return false;
    }
    if (isUserPremium) {
      for (const [fieldKey, selectedOptions] of Object.entries(advancedFilters)) {
        if (!selectedOptions || selectedOptions.length === 0) continue;
        const fieldDef = DISCOVERY_FILTER_FIELDS.find((f) => f.key === fieldKey);
        const personValue = fieldDef?.topLevel ? item.profiles?.[fieldKey] : item.profiles?.basics?.[fieldKey];
        if (!personValue || !selectedOptions.includes(personValue)) return false;
      }
    }
    return true;
  });

  const filtersSummaryCount = intentionFilter.length + activeQuickCount + totalActiveCount;
  const filtersSummaryModeLabel = discoveryMode === 'browse' ? 'Browse' : 'Crossed Paths';
  const filtersSummaryText = filtersSummaryCount > 0
    ? `${filtersSummaryModeLabel} · ${filtersSummaryCount} filter${filtersSummaryCount === 1 ? '' : 's'}`
    : filtersSummaryModeLabel;

  return (
    <Container style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            {!embedded && (
              <Text style={styles.headerTitle} accessibilityRole="header">
                {discoveryMode === 'browse' ? 'Browse' : t('discovery.title')}
              </Text>
            )}
          </View>
          <View style={styles.headerIconsRow}>
            <TouchableOpacity
              onPress={showRadiusInfo}
              style={styles.headerIconButton}
              accessibilityLabel={discoveryMode === 'browse' ? 'Learn how Browse works' : 'Learn how Crossed Paths works'}
              accessibilityRole="button"
            >
              <Text style={styles.headerIconText}>ⓘ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={toggleViewStyle}
              style={styles.headerIconButton}
              accessibilityLabel={viewStyle === 'cards' ? 'Currently on card view, switch to list view' : 'Currently on list view, switch to card view'}
              accessibilityRole="button"
            >
              <Text style={styles.headerIconText}>{viewStyle === 'cards' ? '🃏' : '📋'}</Text>
            </TouchableOpacity>
            {discoveryMode === 'crossedPaths' && (
              <TouchableOpacity
                onPress={() => setShowSightingsOverview(true)}
                style={styles.headerIconButton}
                accessibilityLabel="See all your crossed paths on a map"
                accessibilityRole="button"
              >
                <Text style={styles.headerIconText}>🗺️</Text>
              </TouchableOpacity>
            )}
            {/* Aug 30 2026 (CLAUDE.md, external product-critique reply):
                "Dating should own the dating-specific information" -- a
                real entry point into the dedicated Dating Profile, right
                here inside Discover -> People -> Dating rather than only
                reachable through generic Settings. */}
            <TouchableOpacity
              onPress={() => navigation.navigate('DatingPreferences')}
              style={styles.headerIconButton}
              accessibilityLabel="Your Dating Profile — what you're looking for and dating preferences"
              accessibilityRole="button"
            >
              <Text style={styles.headerIconText}>👤</Text>
            </TouchableOpacity>
          </View>
        </View>
        {/* Was a static "Crossed Paths"/"People you've been near recently"
            title+subtitle, unconditionally, even in Browse mode -- directly
            contradicting the mode switcher two rows below it. Now tracks
            whichever mode is actually selected -- and, since the mode
            switcher itself moved into the Filters sheet (Aug 30 2026,
            CLAUDE.md), this subtitle is now the *only* on-screen indicator
            of which discovery mode is active. */}
        <Text style={styles.headerSubtitle}>
          {discoveryMode === 'browse' ? 'A wider pool of people matching your filters' : t('discovery.subtitle')}
        </Text>
      </View>

      {/* The one-time "tap Browse" hint banner was removed -- the two-button
          Crossed Paths / Browse switcher directly above is already
          self-explanatory (clearly labeled, always visible), and the
          banner's own hand emoji read as pointing at the mode buttons
          themselves rather than its own text, which was confusing rather
          than helpful. */}
      {confidenceBannerReason && <ConfidenceModeBanner reason={confidenceBannerReason} onDismiss={handleDismissConfidenceBanner} />}

      {/* Aug 30 2026 (CLAUDE.md, external UX critique response): this one
          button replaces what used to be 3 separate persistent blocks --
          the Crossed Paths/Browse mode switcher, a 2-section Looking
          For/Quick Filters accordion, and a separate premium-gated
          "Filters" chip. All of that content now lives inside FiltersModal
          (extended below), reached from this one honest summary line --
          real state, never a fabricated count. */}
      <TouchableOpacity
        style={[styles.filtersButton, filtersSummaryCount > 0 && styles.filtersButtonActive]}
        onPress={openFilters}
        accessibilityLabel={`Filters, ${filtersSummaryText}`}
        accessibilityRole="button"
      >
        <Feather name="sliders" size={14} color={filtersSummaryCount > 0 ? colors.primary : colors.textSecondary} />
        <Text style={[styles.filtersButtonLabel, filtersSummaryCount > 0 && styles.filtersButtonLabelActive]}>Filters</Text>
        <Text style={styles.filtersButtonSummary} numberOfLines={1}>{filtersSummaryText}</Text>
      </TouchableOpacity>

      {initialLoading ? (
        <View>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : viewStyle === 'cards' ? (
        filteredNearby.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>{discoveryMode === 'browse' ? '🔎' : '📍'}</Text>
            <Text style={styles.emptyTitle}>
              {discoveryMode === 'browse'
                ? 'No one matches your filters in this area yet'
                : (anyFilterActive ? 'No one matches these filters right now' : t('discovery.emptyTitle'))}
            </Text>
            <Text style={styles.emptyText}>
              {discoveryMode === 'browse'
                ? 'Try adjusting your filters, or check back as more people join.'
                : (anyFilterActive ? 'Try adjusting or clearing your filters above.' : t('discovery.emptyText'))}
            </Text>
          </View>
        ) : (
          <SwipeableDiscoveryCards
            data={filteredNearby}
            photoUrls={photoUrls}
            onlineStatuses={onlineStatuses}
            onNotice={handleCardNotice}
            onWave={handleCardWave}
            onViewProfile={(userId) => navigation.navigate('ViewProfile', { userId, viewContext: 'dating' })}
            onReport={(id, name) => setReportTarget({ id, name })}
            compatibilityColor={compatibilityColor}
            onNeedMore={discoveryMode === 'browse' ? loadMoreBrowse : undefined}
          />
        )
      ) : (
      <FlatList
        data={filteredNearby}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        onEndReached={discoveryMode === 'browse' ? loadMoreBrowse : undefined}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          discoveryMode === 'browse' && loadingMoreBrowse ? (
            <View style={{ paddingVertical: spacing.lg }}>
              <SkeletonCard />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>{discoveryMode === 'browse' ? '🔎' : '📍'}</Text>
            <Text style={styles.emptyTitle}>
              {discoveryMode === 'browse'
                ? 'No one matches your filters in this area yet'
                : (anyFilterActive ? 'No one matches these filters right now' : t('discovery.emptyTitle'))}
            </Text>
            <Text style={styles.emptyText}>
              {discoveryMode === 'browse'
                ? 'Try adjusting your filters, or check back as more people join.'
                : (anyFilterActive ? 'Try adjusting or clearing your filters above.' : t('discovery.emptyText'))}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const crossedPathsTime = discoveryMode === 'browse' ? null : formatCrossedPathsTime(item.last_seen_at);
          return (
          <AnimatedListItem index={index}>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.tappableProfileArea}
              onPress={() => navigation.navigate('ViewProfile', { userId: item.otherUserId, viewContext: 'dating' })}
              activeOpacity={0.9}
              accessibilityLabel={`View ${item.profiles?.display_name}'s profile${onlineStatuses[item.otherUserId] ? ', online now' : ''}`}
              accessibilityRole="button"
            >
              <View>
                <Image
                  source={{ uri: photoUrls[item.id] || 'https://placehold.co/200' }}
                  style={styles.avatar}
                />
                {onlineStatuses[item.otherUserId] && <View style={styles.onlineDot} />}
              </View>
            </TouchableOpacity>
            <View style={styles.cardBody}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{item.profiles?.display_name}</Text>
                {item.profiles?.photo_verified && (
                  <Text style={styles.verifiedBadge}>✓</Text>
                )}
                {item.compatibilityScore !== null && (
                  <TouchableOpacity
                    style={[styles.compatBadge, { borderColor: compatibilityColor(item.compatibilityScore) }]}
                    onPress={() => showCompatibilityReport(item)}
                    accessibilityLabel={`${item.compatibilityScore} percent compatible, view details`}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.compatText, { color: compatibilityColor(item.compatibilityScore) }]}>
                      {item.compatibilityScore}% · Why?
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              {discoveryMode === 'browse' ? (
                <View style={styles.proximityRow}>
                  <Text style={styles.proximityText}>🔎 Matches your filters</Text>
                </View>
              ) : (
                <View style={styles.proximityRow}>
                  <Text style={styles.proximityText}>
                    📍 Within about 35 feet{crossedPathsTime ? ` · Crossed paths ${crossedPathsTime}` : ''}
                  </Text>
                  {(item.sightingLat != null) && (
                    <TouchableOpacity
                      onPress={() => setSightingMapTarget(item)}
                      accessibilityLabel="View roughly where you crossed paths, on a map"
                      accessibilityRole="button"
                    >
                      <Text style={styles.viewOnMapText}>View on map</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              <Text style={styles.bio} numberOfLines={2}>{item.profiles?.bio}</Text>
              {item.sharedInterests?.length > 0 && (
                <Text style={styles.sharedText}>
                  ✨ {t('discovery.youBothLike')} {item.sharedInterests.slice(0, 3).join(', ')}
                  {item.sharedInterests.length > 3 ? ` +${item.sharedInterests.length - 3} ${t('discovery.moreCount')}` : ''}
                </Text>
              )}
              <View style={styles.cardActions}>
                <ScaleButton
                  style={styles.noticeButton}
                  onPress={() => sendNotice(item.otherUserId)}
                  accessibilityLabel={`Send a Notice to ${item.profiles?.display_name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.noticeButtonText}>{t('discovery.notice')}</Text>
                </ScaleButton>
                <ScaleButton
                  style={styles.waveButton}
                  onPress={() => confirmWave(item.otherUserId)}
                  accessibilityLabel={`Send a Wave to ${item.profiles?.display_name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.waveButtonText}>👋 {t('discovery.wave')}</Text>
                </ScaleButton>
                <TouchableOpacity
                  style={styles.moreButton}
                  onPress={() => setReportTarget({ id: item.otherUserId, name: item.profiles?.display_name })}
                  accessibilityLabel={`Report or block ${item.profiles?.display_name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.moreButtonText}>⋯</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </AnimatedListItem>
        );
        }}
      />
      )}

      {undoState && (
        <Animated.View
          style={[styles.undoBanner, { opacity: undoOpacity }]}
          accessible={true}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.undoText}>{undoState.isWave ? 'Wave' : 'Notice'} sent</Text>
          <TouchableOpacity
            onPress={handleUndo}
            accessibilityLabel={`Undo sending ${undoState.isWave ? 'Wave' : 'Notice'}`}
            accessibilityRole="button"
          >
            <Text style={styles.undoButton}>Undo</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      <DatingPreferencesPromptModal
        visible={showDatingPrefsPrompt}
        userId={myUserId}
        initialValues={myProfile}
        onDone={(fields) => {
          setShowDatingPrefsPrompt(false);
          setMyProfile((prev) => (prev ? { ...prev, ...fields } : prev));
        }}
      />

      <ReportBlockModal
        visible={!!reportTarget}
        onClose={() => {
          setReportTarget(null);
          load();
        }}
        reportedUserId={reportTarget?.id}
        reportedUserName={reportTarget?.name}
      />

      <CompatibilityReportModal
        visible={!!compatModalReport}
        onClose={() => setCompatModalReport(null)}
        report={compatModalReport}
        theirName={compatModalName}
      />

      <FiltersModal
        visible={filtersModalVisible}
        onClose={() => setFiltersModalVisible(false)}
        isPremium={isUserPremium}
        onUpgrade={() => { setFiltersModalVisible(false); navigation.navigate('Paywall'); }}
        discoveryMode={discoveryMode}
        onChangeDiscoveryMode={switchDiscoveryMode}
        intentionOptions={INTENTION_OPTIONS}
        intentionFilter={intentionFilter}
        onToggleIntention={(value) => setIntentionFilter((prev) => (
          prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
        ))}
        quickFilterOrder={quickFilterOrder}
        quickFilterVisible={quickFilterVisible}
        quickFilters={{ verified: verifiedOnly, highCompat: highCompatOnly, online: onlineOnly }}
        onToggleQuickFilter={(key) => {
          if (key === 'verified') setVerifiedOnly((v) => !v);
          if (key === 'highCompat') setHighCompatOnly((v) => !v);
          if (key === 'online') setOnlineOnly((v) => !v);
        }}
        onCustomizeQuickFilters={() => { setFiltersModalVisible(false); navigation.navigate('QuickFilterCustomize'); }}
        onClearFreeFilters={() => {
          setIntentionFilter([]);
          setVerifiedOnly(false);
          setHighCompatOnly(false);
          setOnlineOnly(false);
        }}
        fields={DISCOVERY_FILTER_FIELDS}
        activeFilters={advancedFilters}
        onApply={setAdvancedFilters}
        showAgeRange
        ageRange={ageRangeFilter}
        onAgeRangeChange={setAgeRangeFilter}
      />

      <SightingMapModal
        visible={!!sightingMapTarget}
        onClose={() => setSightingMapTarget(null)}
        latitude={sightingMapTarget?.sightingLat}
        longitude={sightingMapTarget?.sightingLng}
        personName={sightingMapTarget?.profiles?.display_name}
      />

      {showSightingsOverview && (
        <View style={StyleSheet.absoluteFill}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={styles.overviewHeader}>
              <Text style={styles.overviewTitle}>All Your Crossed Paths</Text>
              <TouchableOpacity onPress={() => setShowSightingsOverview(false)} accessibilityLabel="Close map" accessibilityRole="button">
                <Text style={styles.overviewClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <SightingsOverviewMap
              sightings={nearby}
              photoUrls={photoUrls}
              userLocation={null}
              onSelectSighting={(s) => navigation.navigate('ViewProfile', { userId: s.otherUserId, viewContext: 'dating' })}
            />
          </SafeAreaView>
        </View>
      )}
    </Container>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  // Aug 30 2026 (CLAUDE.md, external UX critique response): the three
  // header-right actions (info / Cards-List / crossed-paths map) used to
  // be bordered, labeled pills -- same visual weight class as the primary
  // navigation controls above them. Shrunk to plain icon buttons, no
  // border/background, no text label -- same 3 actions, same
  // accessibility labels, just lighter. The info icon also moves off
  // brand coral (`colors.primary`) to a neutral tone -- it's informational
  // chrome, not an action, and this app's own already-locked "coral =
  // action, not decoration" rule (see the Aug 16 2026 coral-usage section)
  // already says brand color shouldn't be spent on it.
  headerIconsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerIconButton: { padding: spacing.xs },
  headerIconText: { fontSize: 17, color: colors.textSecondary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  // Replaces the old modeSwitcher (2 full-width pill buttons) + a
  // 2-section accordion (Looking For / Quick Filters) + a separate
  // premium-gated "Filters" chip -- all three now live inside the one
  // unified FiltersModal, reached from this single summary button.
  filtersButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: spacing.lg, marginBottom: spacing.md, alignSelf: 'flex-start',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filtersButtonActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  filtersButtonLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  filtersButtonLabelActive: { color: colors.primary },
  filtersButtonSummary: { color: colors.textTertiary, fontSize: 13, maxWidth: 180 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.card,
  },
  tappableProfileArea: { width: '100%' },
  avatar: { width: '100%', height: 280, backgroundColor: colors.surfaceElevated },
  onlineDot: {
    position: 'absolute', top: spacing.md, right: spacing.md,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.success, borderWidth: 2.5, borderColor: colors.surface,
  },
  cardBody: { padding: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  name: { ...typography.headline, color: colors.textPrimary },
  verifiedBadge: { color: colors.success, fontSize: 16, fontWeight: '700' },
  compatBadge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  compatText: { fontSize: 11, fontWeight: '700' },
  proximityRow: { marginBottom: spacing.xs },
  proximityText: { ...typography.small, color: colors.textTertiary },
  viewOnMapText: { color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 2 },
  overviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  overviewTitle: { ...typography.headline, color: colors.textPrimary },
  overviewClose: { color: colors.textTertiary, fontSize: 20 },
  bio: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  sharedText: { color: colors.primary, fontSize: 12, fontWeight: '600', marginBottom: spacing.md },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  noticeButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flex: 1,
    alignItems: 'center',
  },
  noticeButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  waveButton: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    flex: 1,
    alignItems: 'center',
  },
  waveButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  moreButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  moreButtonText: { color: colors.textTertiary, fontSize: 20, fontWeight: '700' },
  undoBanner: {
    position: 'absolute', bottom: spacing.lg, left: spacing.lg, right: spacing.lg,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.textPrimary, borderRadius: radius.full,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  undoText: { color: colors.background, fontSize: 14, fontWeight: '600' },
  undoButton: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});
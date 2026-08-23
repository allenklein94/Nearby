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

export default function DiscoveryScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
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
  const [expandedFilterSection, setExpandedFilterSection] = useState(null);
  const [sightingMapTarget, setSightingMapTarget] = useState(null);
  const [showSightingsOverview, setShowSightingsOverview] = useState(false);
  const [showBrowseCallout, setShowBrowseCallout] = useState(false);
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
      const { data: mine } = await supabase.from('profiles').select('interests, basics, discovery_view_style, seen_browse_callout, quick_filter_order, quick_filter_visible, discovery_gender, show_me, preferred_min_age, preferred_max_age, relationship_intention, dating_preferences_set').eq('id', myId).single();
      if (mine?.quick_filter_order) setQuickFilterOrder(mine.quick_filter_order);
      if (mine?.quick_filter_visible) setQuickFilterVisible(mine.quick_filter_visible);
      setMyProfile(mine);
      setViewStyle(mine?.discovery_view_style ?? 'list');

      const reason = await shouldOfferBreak(myId);
      setConfidenceBannerReason(reason);

      if (mine && !mine.seen_browse_callout) {
        setShowBrowseCallout(true);
      }

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

  async function dismissBrowseCallout() {
    setShowBrowseCallout(false);
    if (myUserId) {
      await supabase.from('profiles').update({ seen_browse_callout: true }).eq('id', myUserId);
    }
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

  function openFilters() {
    if (!isUserPremium) {
      Alert.alert(
        'Advanced Filters is Premium',
        'Filtering by education, drinking, religion, love language, and more is a Premium feature. Basic filters stay free.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Upgrade to Premium', onPress: () => navigation.navigate('Paywall') },
        ]
      );
      return;
    }
    setFiltersModalVisible(true);
  }

  function toggleFilterSection(section) {
    setExpandedFilterSection((prev) => (prev === section ? null : section));
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
  const lookingForSummary = intentionFilter.length > 0
    ? intentionFilter.map((v) => INTENTION_OPTIONS.find((o) => o.value === v)?.label).filter(Boolean).join(', ')
    : 'Any';
  const activeQuickCount = [verifiedOnly, highCompatOnly, onlineOnly].filter(Boolean).length;
  const quickFilterSummary = activeQuickCount > 0 ? `${activeQuickCount} active` : 'None';

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle} accessibilityRole="header">{t('discovery.title')}</Text>
          <TouchableOpacity
            onPress={showRadiusInfo}
            style={styles.infoButton}
            accessibilityLabel="Learn how Crossed Paths works"
            accessibilityRole="button"
          >
            <Text style={styles.infoButtonText}>ⓘ</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={toggleViewStyle}
            style={styles.viewToggleButton}
            accessibilityLabel={viewStyle === 'cards' ? 'Currently on card view, switch to list view' : 'Currently on list view, switch to card view'}
            accessibilityRole="button"
          >
            <Text style={styles.viewToggleIcon}>{viewStyle === 'cards' ? '🃏' : '📋'}</Text>
            <Text style={styles.viewToggleLabel}>{viewStyle === 'cards' ? 'Cards' : 'List'}</Text>
          </TouchableOpacity>
          {discoveryMode === 'crossedPaths' && (
            <TouchableOpacity
              onPress={() => setShowSightingsOverview(true)}
              style={styles.infoButton}
              accessibilityLabel="See all your crossed paths on a map"
              accessibilityRole="button"
            >
              <Text style={styles.infoButtonText}>🗺️</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.headerSubtitle}>{t('discovery.subtitle')}</Text>
      </View>

      <View style={styles.modeSwitcher}>
        <TouchableOpacity
          style={[styles.modeButton, discoveryMode === 'crossedPaths' && styles.modeButtonActive]}
          onPress={() => switchDiscoveryMode('crossedPaths')}
          accessibilityLabel="Crossed Paths, people you've actually been near"
          accessibilityRole="button"
          accessibilityState={{ selected: discoveryMode === 'crossedPaths' }}
        >
          <Text style={[styles.modeButtonText, discoveryMode === 'crossedPaths' && styles.modeButtonTextActive]}>📍 Crossed Paths</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, discoveryMode === 'browse' && styles.modeButtonActive]}
          onPress={() => switchDiscoveryMode('browse')}
          accessibilityLabel="Browse, a wider pool of people matching your filters, not limited to proximity"
          accessibilityRole="button"
          accessibilityState={{ selected: discoveryMode === 'browse' }}
        >
          <Text style={[styles.modeButtonText, discoveryMode === 'browse' && styles.modeButtonTextActive]}>🔎 Browse</Text>
        </TouchableOpacity>
      </View>

      {showBrowseCallout && (
        <View style={styles.calloutBanner}>
          <Text style={styles.calloutText}>
            👆 New: tap "Browse" to see a wider pool of people matching your filters, not just who you've crossed paths with.
          </Text>
          <TouchableOpacity onPress={dismissBrowseCallout} accessibilityLabel="Dismiss this tip" accessibilityRole="button">
            <Text style={styles.calloutDismiss}>Got it</Text>
          </TouchableOpacity>
        </View>
      )}

      {confidenceBannerReason && <ConfidenceModeBanner reason={confidenceBannerReason} onDismiss={handleDismissConfidenceBanner} />}

      <View style={styles.accordionContainer}>
        <TouchableOpacity
          style={styles.accordionHeader}
          onPress={() => toggleFilterSection('lookingFor')}
          accessibilityLabel={`Looking For: ${lookingForSummary}, ${expandedFilterSection === 'lookingFor' ? 'tap to collapse' : 'tap to expand'}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: expandedFilterSection === 'lookingFor' }}
        >
          <Text style={styles.accordionHeaderLabel}>💘 Looking For</Text>
          <View style={styles.accordionHeaderRight}>
            <Text style={styles.accordionHeaderValue}>{lookingForSummary}</Text>
            <Text style={styles.accordionChevron}>{expandedFilterSection === 'lookingFor' ? '⌃' : '⌄'}</Text>
          </View>
        </TouchableOpacity>
        {expandedFilterSection === 'lookingFor' && (
          <View style={styles.accordionBody}>
            <View style={styles.chipsWrapInline}>
              {INTENTION_OPTIONS.map((option) => {
                const active = intentionFilter.includes(option.value);
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setIntentionFilter((prev) => active ? prev.filter((v) => v !== option.value) : [...prev, option.value])}
                    accessibilityLabel={`Filter by ${option.label}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{option.icon} {option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.accordionDivider} />

        <TouchableOpacity
          style={styles.accordionHeader}
          onPress={() => toggleFilterSection('quick')}
          accessibilityLabel={`Quick Filters: ${quickFilterSummary}, ${expandedFilterSection === 'quick' ? 'tap to collapse' : 'tap to expand'}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: expandedFilterSection === 'quick' }}
        >
          <Text style={styles.accordionHeaderLabel}>⚡ Quick Filters</Text>
          <View style={styles.accordionHeaderRight}>
            <Text style={styles.accordionHeaderValue}>{quickFilterSummary}</Text>
            <Text style={styles.accordionChevron}>{expandedFilterSection === 'quick' ? '⌃' : '⌄'}</Text>
          </View>
        </TouchableOpacity>
        {expandedFilterSection === 'quick' && (
          <View style={styles.accordionBody}>
            <View style={styles.chipsWrapInline}>
              {quickFilterOrder.filter((key) => quickFilterVisible.includes(key)).map((key) => {
                const configs = {
                  verified: { active: verifiedOnly, toggle: () => setVerifiedOnly(!verifiedOnly), label: '✓ Verified Only', a11y: 'Filter to only photo-verified profiles' },
                  highCompat: { active: highCompatOnly, toggle: () => setHighCompatOnly(!highCompatOnly), label: '🎯 70%+ Match', a11y: 'Filter to 70 percent compatible or higher' },
                  online: { active: onlineOnly, toggle: () => setOnlineOnly(!onlineOnly), label: '🟢 Online Now', a11y: 'Filter to only people online now' },
                };
                const config = configs[key];
                if (!config) return null;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.filterChip, config.active && styles.filterChipActive]}
                    onPress={config.toggle}
                    accessibilityLabel={config.a11y}
                    accessibilityRole="button"
                    accessibilityState={{ selected: config.active }}
                  >
                    <Text style={[styles.filterChipText, config.active && styles.filterChipTextActive]}>{config.label}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                onPress={() => navigation.navigate('QuickFilterCustomize')}
                accessibilityLabel="Customize which Quick Filters show and their order"
                accessibilityRole="button"
              >
                <Text style={styles.customizeLink}>⚙️ Customize</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[styles.moreFiltersButton, totalActiveCount > 0 && styles.moreFiltersButtonActive]}
        onPress={openFilters}
        accessibilityLabel={`More filters, Premium${totalActiveCount > 0 ? `, ${totalActiveCount} active` : ''}`}
        accessibilityRole="button"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {isUserPremium ? (
            <Feather name="sliders" size={14} color={totalActiveCount > 0 ? colors.primary : colors.textSecondary} />
          ) : (
            <Text style={{ fontSize: 13 }}>🔒</Text>
          )}
          <Text style={[styles.moreFiltersText, totalActiveCount > 0 && styles.moreFiltersTextActive]}>
            Filters{totalActiveCount > 0 ? ` (${totalActiveCount})` : ''}
          </Text>
        </View>
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
            onViewProfile={(userId) => navigation.navigate('ViewProfile', { userId })}
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
              onPress={() => navigation.navigate('ViewProfile', { userId: item.otherUserId })}
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
              onSelectSighting={(s) => navigation.navigate('ViewProfile', { userId: s.otherUserId })}
            />
          </SafeAreaView>
        </View>
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  infoButton: {
    marginLeft: spacing.sm, width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  infoButtonText: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  viewToggleButton: {
    flexDirection: 'row', alignItems: 'center', marginLeft: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  viewToggleIcon: { fontSize: 18, marginRight: 6 },
  viewToggleLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  accordionContainer: {
    marginHorizontal: spacing.lg, marginBottom: spacing.sm, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  accordionHeaderLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  accordionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  accordionHeaderValue: { color: colors.textTertiary, fontSize: 13 },
  accordionChevron: { color: colors.textTertiary, fontSize: 14 },
  accordionBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  accordionDivider: { height: 1, backgroundColor: colors.border },
  chipsWrapInline: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  modeSwitcher: {
    flexDirection: 'row', marginHorizontal: spacing.lg, marginBottom: spacing.md,
    backgroundColor: colors.surfaceElevated, borderRadius: radius.full, padding: 3,
  },
  modeButton: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.full, alignItems: 'center' },
  modeButtonActive: { backgroundColor: colors.primary },
  modeButtonText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  modeButtonTextActive: { color: '#fff' },
  calloutBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginHorizontal: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  // Phase 3 item 4 of the "Scorecard to 10" initiative (CLAUDE.md): the one coral
  // judgment call left open by the Aug 16 2026 coral audit. "Got it" is a real dismiss
  // action -- the locked rule names "Cancel, dismiss" explicitly as secondary actions
  // that should read neutral, coral reserved for a surface's primary action. The body
  // text next to it is purely informational, not itself interactive. Both now render
  // neutral, matching this app's own established secondary-action convention
  // (AdminVerificationScreen's rejectButtonText, CommunityDetailScreen's
  // leaveButtonText) rather than the ambiguous "self-contained interactive unit"
  // carve-out the audit flagged but left undecided.
  calloutText: { flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginRight: spacing.sm, lineHeight: 16 },
  calloutDismiss: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  filterBarRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  filterRow: { flexGrow: 0, flexShrink: 1 },
  filterChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },
  customizeLink: { color: colors.primary, fontSize: 12, fontWeight: '700', alignSelf: 'center', paddingHorizontal: spacing.sm },
  moreFiltersButton: {
    marginHorizontal: spacing.lg, marginBottom: spacing.md, alignSelf: 'flex-start',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  moreFiltersButtonActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  moreFiltersText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  moreFiltersTextActive: { color: colors.primary },
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
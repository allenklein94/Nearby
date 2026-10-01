import React, { useState, useCallback, useMemo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, FlatList, ScrollView, ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform } from 'react-native';
import FadeInState from '../components/FadeInState';
import { NLoader } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { getMyPartnershipTargets, requestBusinessPartnership } from '../services/businessPartnerships';
import { getActivePartnersByName, getAllActivePartners } from '../services/brandOffers';
import { BUSINESS_CATEGORIES } from './BusinessPartnerApplyScreen';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { groupName } from '../i18n/categoryNames';
import { tr } from '../i18n/translate';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// A business category chip/label in the person's language: the group's icon + its translated name (ui.requestPartner.otherCategory for
// a business filed under Other).
function categoryLabel(key, language) {
  const g = CATEGORY_GROUPS.find((x) => x.key === key);
  return g ? `${g.icon} ${groupName(key, language)}` : `✨ ${tr('ui.requestPartner.otherCategory')}`;
}

// Two entry shapes: no targetType/targetId (top-level Create tab — pick a
// target first) or both passed (a per-target link on GatheringDetailScreen/
// CommunityDetailScreen — skip straight to business search).
export default function RequestBusinessPartnerScreen({ navigation, route }) {
  const { t, language } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const presetTargetType = route.params?.targetType ?? null;
  const presetTargetId = route.params?.targetId ?? null;
  const presetTargetTitle = route.params?.targetTitle ?? null;
  const initialBusinessQuery = route.params?.initialBusinessQuery ?? '';

  const [step, setStep] = useState(presetTargetType ? 'business' : 'target');
  const [targets, setTargets] = useState([]);
  const [loadingTargets, setLoadingTargets] = useState(!presetTargetType);
  const [selectedTarget, setSelectedTarget] = useState(
    presetTargetType ? { type: presetTargetType, id: presetTargetId, title: presetTargetTitle } : null
  );

  const [businessQuery, setBusinessQuery] = useState(initialBusinessQuery);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [browsablePartners, setBrowsablePartners] = useState([]);
  const [loadingBrowsable, setLoadingBrowsable] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState(null);

  useFocusEffect(
    useCallback(() => {
      if (presetTargetType) return;
      let cancelled = false;
      (async () => {
        const data = await getMyPartnershipTargets();
        if (!cancelled) {
          setTargets(data);
          setLoadingTargets(false);
        }
      })();
      return () => { cancelled = true; };
    }, [presetTargetType])
  );

  // Every active business on the platform, shown by default underneath the
  // search box — without this, a business you don't already know the name
  // of is undiscoverable, since search only ever matches a typed name.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const data = await getAllActivePartners();
        if (!cancelled) {
          setBrowsablePartners(data);
          setLoadingBrowsable(false);
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  async function search(text) {
    setBusinessQuery(text);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const data = await getActivePartnersByName(text);
    setResults(data);
    setSearching(false);
  }

  // Only chip categories that at least one real business on the platform
  // actually has — never all 6 keys unconditionally, which would be a filter
  // row promising results a tap would never return. "Uncategorized" only
  // appears if a real business genuinely has no category set yet.
  const availableCategories = useMemo(() => {
    const present = new Set(browsablePartners.map((p) => p.category ?? 'uncategorized'));
    return BUSINESS_CATEGORIES.filter((c) => present.has(c.key)).concat(
      present.has('uncategorized') ? [{ key: 'uncategorized', label: t('ui.requestPartner.uncategorized') }] : []
    );
  }, [browsablePartners]);

  async function submit() {
    if (!selectedTarget || !selectedPartner) return;

    if (message.trim()) {
      const check = await checkTextModeration(message);
      if (!check.safe) {
        return Alert.alert(t('ui.requestPartner.messageNotAllowed'), t('ui.requestPartner.pleaseReviseYourMessageAnd'));
      }
    }

    setSubmitting(true);
    try {
      await requestBusinessPartnership({
        targetType: selectedTarget.type,
        targetId: selectedTarget.id,
        partnerId: selectedPartner.id,
        message: message.trim() || null,
      });
      Alert.alert(t('ui.requestPartner.requestSent'), t('ui.requestPartner.willBeNotifiedYoullHear', { name: selectedPartner.name }), [
        { text: t('ui.requestPartner.ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => submit() });
    }
    setSubmitting(false);
  }

  if (step === 'target') {
    if (loadingTargets) {
      return (
        <SafeAreaView style={styles.container}>
          <NLoader fullScreen={false} />
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.header}>{t('ui.requestPartner.whichGatheringOrCommunity')}</Text>
        <FlatList
          data={targets}
          keyExtractor={(t) => `${t.type}-${t.id}`}
          contentContainerStyle={{ padding: spacing.lg }}
          ListEmptyComponent={
            <FadeInState style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {t('ui.requestPartner.youDontHaveAGathering')}
              </Text>
              <TouchableOpacity style={styles.emptyLink} onPress={() => navigation.navigate('CreateGathering')}>
                <Text style={styles.emptyLinkText}>{t('ui.requestPartner.hostAGathering')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.emptyLink} onPress={() => navigation.navigate('CreateCommunity')}>
                <Text style={styles.emptyLinkText}>{t('ui.requestPartner.createACommunity')}</Text>
              </TouchableOpacity>
            </FadeInState>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.85}
              onPress={() => {
                setSelectedTarget(item);
                setStep('business');
              }}
              accessibilityRole="button"
            >
              <Text style={styles.rowIcon}>{item.type === 'gathering' ? '🎉' : '👥'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
        />
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.container}>
        <Text style={styles.header}>{t('ui.requestPartner.partnerWithABusiness')}</Text>
        <Text style={styles.subheader}>for {selectedTarget?.title}</Text>

        {!selectedPartner ? (
          <>
            <TextInput
              style={styles.input}
              placeholder={t('ui.requestPartner.searchBusinessesByName')}
              placeholderTextColor={colors.textTertiary}
              value={businessQuery}
              onChangeText={search}
              accessibilityLabel={t('ui.requestPartner.searchBusinessesA11y')}
            />
            {(() => {
              const isSearching = businessQuery.trim().length >= 2;
              const sourceData = isSearching ? results : browsablePartners;
              const listData = categoryFilter
                ? sourceData.filter((p) => (p.category ?? 'uncategorized') === categoryFilter)
                : sourceData;
              const busy = isSearching ? searching : loadingBrowsable;
              return (
                <>
                  {availableCategories.length > 0 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ marginTop: spacing.md }}
                      contentContainerStyle={{ gap: spacing.xs }}
                    >
                      <TouchableOpacity
                        style={[styles.chip, !categoryFilter && styles.chipActive]}
                        onPress={() => setCategoryFilter(null)}
                        accessibilityRole="button"
                        accessibilityLabel={t('ui.requestPartner.allCategoriesA11y')}
                        accessibilityState={{ selected: !categoryFilter }}
                      >
                        <Text style={[styles.chipText, !categoryFilter && styles.chipTextActive]}>{t('ui.requestPartner.all')}</Text>
                      </TouchableOpacity>
                      {availableCategories.map((c) => (
                        <TouchableOpacity
                          key={c.key}
                          style={[styles.chip, categoryFilter === c.key && styles.chipActive]}
                          onPress={() => setCategoryFilter(categoryFilter === c.key ? null : c.key)}
                          accessibilityRole="button"
                          accessibilityLabel={c.key === 'uncategorized' ? c.label : categoryLabel(c.key, language)}
                          accessibilityState={{ selected: categoryFilter === c.key }}
                        >
                          <Text style={[styles.chipText, categoryFilter === c.key && styles.chipTextActive]}>{c.key === 'uncategorized' ? c.label : categoryLabel(c.key, language)}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                  {!isSearching && !loadingBrowsable && browsablePartners.length > 0 && (
                    <Text style={styles.browseLabel}>{t('ui.requestPartner.businessesOnNearby')}</Text>
                  )}
                  {busy && <NLoader fullScreen={false} size="inline" kind="businesses" />}
                  <FlatList
                    data={listData}
                    keyExtractor={(p) => p.id}
                    contentContainerStyle={{ paddingTop: spacing.md }}
                    ListEmptyComponent={
                      !busy ? (
                        <Text style={styles.emptyText}>
                          {isSearching
                            ? t('ui.requestPartner.noMatchingBusinessesFound')
                            : categoryFilter
                              ? t('ui.requestPartner.noBusinessesInThisCategory')
                              : t('ui.requestPartner.noBusinessesOnNearbyYet')}
                        </Text>
                      ) : null
                    }
                    renderItem={({ item }) => (
                      <TouchableOpacity style={styles.row} activeOpacity={0.85} onPress={() => setSelectedPartner(item)} accessibilityRole="button">
                        {item.logo_url ? (
                          <Image source={{ uri: item.logo_url }} style={styles.logo} />
                        ) : (
                          <View style={[styles.logo, styles.logoFallback]}>
                            <Text style={styles.logoFallbackText}>🏪</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>{item.name}</Text>
                          {item.category && <Text style={styles.rowSubtitle}>{categoryLabel(item.category, language)}</Text>}
                        </View>
                      </TouchableOpacity>
                    )}
                  />
                </>
              );
            })()}
          </>
        ) : (
          <>
            <View style={styles.selectedCard}>
              <Text style={styles.rowTitle}>{selectedPartner.name}</Text>
              <TouchableOpacity onPress={() => setSelectedPartner(null)}>
                <Text style={styles.changeLink}>{t('ui.requestPartner.change')}</Text>
              </TouchableOpacity>
            </View>
            {selectedTarget?.type === 'gathering' ? (
              <>
                {/* Same form and request model as asking nearby businesses; the only difference is that it goes to this one business. */}
                <Text style={styles.rowSubtitle}>{t('ui.requestPartner.tellWhatYoureLookingFor', { name: selectedPartner.name })}</Text>
                <TouchableOpacity
                  style={styles.submitButton}
                  onPress={() => navigation.navigate('AskBusiness', {
                    gatheringId: selectedTarget.id,
                    gatheringTitle: selectedTarget.title,
                    targetPartner: { id: selectedPartner.id, name: selectedPartner.name },
                    partnershipTarget: { targetType: 'gathering', targetId: selectedTarget.id },
                  })}
                  accessibilityRole="button"
                  accessibilityLabel={t('ui.requestPartner.askA11y', { name: selectedPartner.name })}
                >
                  <Text style={styles.submitButtonText}>{t('ui.requestPartner.ask', { name: selectedPartner.name })}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
            <TextInput
                style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
                placeholder={t('ui.requestPartner.addANoteForThem')}
                placeholderTextColor={colors.textTertiary}
                value={message}
                onChangeText={setMessage}
                multiline
                accessibilityLabel={t('ui.requestPartner.optionalNoteToTheBusinessA11y')}
              />
              <TouchableOpacity style={styles.submitButton} onPress={submit} disabled={submitting} accessibilityRole="button">
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>{t('ui.requestPartner.sendRequest')}</Text>}
              </TouchableOpacity>
                        </>
            )}
          </>
        )}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  header: { ...typography.display, color: colors.textPrimary, marginBottom: 2 },
  subheader: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  browseLabel: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, color: colors.textPrimary, ...typography.body,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm, ...shadow.card,
  },
  rowIcon: { fontSize: 24, marginRight: spacing.md },
  rowTitle: { ...typography.headline, color: colors.textPrimary },
  rowSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  chevron: { color: colors.textTertiary, fontSize: 24 },
  logo: { width: 36, height: 36, borderRadius: 18, marginRight: spacing.md },
  logoFallback: { backgroundColor: colors.surfaceElevated, justifyContent: 'center', alignItems: 'center' },
  logoFallbackText: { fontSize: 18 },
  selectedCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  changeLink: { ...typography.caption, color: colors.primary },
  submitButton: {
    backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md,
    alignItems: 'center', marginTop: spacing.md,
  },
  submitButtonText: { ...typography.headline, color: '#fff' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xl },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
  emptyLink: { paddingVertical: spacing.sm },
  emptyLinkText: { ...typography.headline, color: colors.primary },
});

import React, { useState, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, FlatList, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import FadeInState from '../components/FadeInState';
import { NLoader } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { getMyPartnershipTargets, requestBusinessPartnership } from '../services/businessPartnerships';
import BusinessPicker from '../components/BusinessPicker';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Partner a COMMUNITY with one business (pick it, add a note, send the partnership request), or, from the Create tab with
// no target, pick which gathering or community first. A gathering never stays here: asking one business for a gathering
// is the ordinary request on Ask a business, which picks the business in place (screen-reduction audit B7, 2026-10-09).
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

  const [selectedPartner, setSelectedPartner] = useState(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
                if (item.type === 'gathering') {
                  // A gathering's ask to one business is the ordinary request; Ask a business picks the business in place.
                  navigation.replace('AskBusiness', {
                    gatheringId: item.id,
                    gatheringTitle: item.title,
                    pickBusiness: true,
                    initialBusinessQuery,
                    partnershipTarget: { targetType: 'gathering', targetId: item.id },
                  });
                  return;
                }
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
          <ScrollView keyboardShouldPersistTaps="handled">
            <BusinessPicker initialQuery={initialBusinessQuery} onPick={setSelectedPartner} />
          </ScrollView>
        ) : (
          <>
            <View style={styles.selectedCard}>
              <Text style={styles.rowTitle}>{selectedPartner.name}</Text>
              <TouchableOpacity onPress={() => setSelectedPartner(null)}>
                <Text style={styles.changeLink}>{t('ui.requestPartner.change')}</Text>
              </TouchableOpacity>
            </View>
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

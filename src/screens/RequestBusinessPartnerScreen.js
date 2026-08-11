import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, FlatList, ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyPartnershipTargets, requestBusinessPartnership } from '../services/businessPartnerships';
import { getActivePartnersByName, getAllActivePartners } from '../services/brandOffers';
import { checkTextModeration } from '../services/textModeration';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Two entry shapes: no targetType/targetId (top-level Create tab — pick a
// target first) or both passed (a per-target link on GatheringDetailScreen/
// CommunityDetailScreen — skip straight to business search).
export default function RequestBusinessPartnerScreen({ navigation, route }) {
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

  async function submit() {
    if (!selectedTarget || !selectedPartner) return;

    if (message.trim()) {
      const check = await checkTextModeration(message);
      if (!check.safe) {
        return Alert.alert('Message not allowed', 'Please revise your message and try again.');
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
      Alert.alert('Request sent!', `${selectedPartner.name} will be notified — you'll hear back once they respond.`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Could not send request', e.message);
    }
    setSubmitting(false);
  }

  if (step === 'target') {
    if (loadingTargets) {
      return (
        <SafeAreaView style={styles.container}>
          <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.header}>Which gathering or community?</Text>
        <FlatList
          data={targets}
          keyExtractor={(t) => `${t.type}-${t.id}`}
          contentContainerStyle={{ padding: spacing.lg }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                You don't have a gathering or community to attach a business partner to yet.
              </Text>
              <TouchableOpacity style={styles.emptyLink} onPress={() => navigation.navigate('CreateGathering')}>
                <Text style={styles.emptyLinkText}>🎉 Start a Gathering</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.emptyLink} onPress={() => navigation.navigate('CreateCommunity')}>
                <Text style={styles.emptyLinkText}>👥 Create a Community</Text>
              </TouchableOpacity>
            </View>
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
        <Text style={styles.header}>Partner with a business</Text>
        <Text style={styles.subheader}>for {selectedTarget?.title}</Text>

        {!selectedPartner ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Search businesses by name"
              placeholderTextColor={colors.textTertiary}
              value={businessQuery}
              onChangeText={search}
              accessibilityLabel="Search businesses"
            />
            {(() => {
              const isSearching = businessQuery.trim().length >= 2;
              const listData = isSearching ? results : browsablePartners;
              const busy = isSearching ? searching : loadingBrowsable;
              return (
                <>
                  {!isSearching && !loadingBrowsable && browsablePartners.length > 0 && (
                    <Text style={styles.browseLabel}>Businesses on Nearby</Text>
                  )}
                  {busy && <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.primary} />}
                  <FlatList
                    data={listData}
                    keyExtractor={(p) => p.id}
                    contentContainerStyle={{ paddingTop: spacing.md }}
                    ListEmptyComponent={
                      !busy ? (
                        <Text style={styles.emptyText}>
                          {isSearching ? 'No matching businesses found.' : 'No businesses on Nearby yet.'}
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
                        <Text style={styles.rowTitle}>{item.name}</Text>
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
                <Text style={styles.changeLink}>Change</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
              placeholder="Add a note for them (optional)"
              placeholderTextColor={colors.textTertiary}
              value={message}
              onChangeText={setMessage}
              multiline
              accessibilityLabel="Optional note to the business"
            />
            <TouchableOpacity style={styles.submitButton} onPress={submit} disabled={submitting} accessibilityRole="button">
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Send Request</Text>}
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

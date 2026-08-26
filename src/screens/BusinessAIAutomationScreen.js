// Business Intelligence Phase 6, Step 4 (see CLAUDE.md's own locked
// plan): the real Business AI Automation settings surface -- a level
// radio selector (0-3), entitlement-locked options, safety
// confirmations, a named-policy editor for Level 2/3, and a real
// Activity Log with Undo/Withdraw where applicable. Reached from
// BusinessDashboardScreen's own "✨ AI Automation" row -- a dedicated
// screen, not more inline UI on that already very large file, matching
// the same precedent BusinessAIAssistantScreen already set.
//
// Every real gate here is a UX preview only, same as
// renderLockedFeature() elsewhere -- the actual enforcement is always
// the server-side entitlement check inside set_business_ai_trust_level()/
// upsert_business_ai_policy() themselves.
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Switch,
  StyleSheet, SafeAreaView, Alert, ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { INTEREST_OPTIONS } from '../constants/gatheringCategories';
import { getBusinessExperiences } from '../services/brandOffers';
import { withdrawBusinessOffer } from '../services/businessFulfillment';
import { getBusinessEntitlements, hasEntitlement } from '../services/entitlements';
import {
  getBusinessAiTrustLevel, setBusinessAiTrustLevel,
  getBusinessAiPolicies, upsertBusinessAiPolicy, deleteBusinessAiPolicy,
  getAiActivityLog, undoAiAction,
  AI_ACTION_TYPE_LABELS, AI_BLOCKED_REASON_LABELS,
} from '../services/aiTrustEngine';

const LEVELS = [
  {
    level: 0,
    title: 'Level 0 — Suggest',
    description: 'AI only ever suggests. You review and confirm everything yourself, exactly as it works today.',
    feature: null,
  },
  {
    level: 1,
    title: 'Level 1 — Assisted',
    description: 'Nearby auto-applies low-risk, reversible profile details the instant a trusted signal detects one (a confirmed category or attribute). Never offers, prices, or anything customer-facing.',
    feature: null,
  },
  {
    level: 2,
    title: 'Level 2 — Routine Automation',
    description: 'Inside rules you create below, Nearby can automatically send a pre-approved offer when a matching request comes in — always from an offer template you already approved, never inventing new terms.',
    feature: 'ai_level_2',
  },
  {
    level: 3,
    title: 'Level 3 — Controlled Autopilot',
    description: 'You define a named policy scoped to one specific scenario, and Nearby executes it automatically within that exact boundary. The same real action as Level 2 — narrower, and with a stronger confirmation step.',
    feature: 'ai_level_3',
  },
];

function normalizeTimeInput(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  return /^\d{1,2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

function formatRelativeTime(iso) {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function BusinessAIAutomationScreen({ route }) {
  const { partnerId, partnerName } = route.params || {};
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [loading, setLoading] = useState(true);
  const [trustLevel, setTrustLevel] = useState(0);
  const [entitlements, setEntitlements] = useState(null);
  const [changingLevel, setChangingLevel] = useState(false);

  const [policies, setPolicies] = useState([]);
  const [experiences, setExperiences] = useState([]);
  const [loadingPolicies, setLoadingPolicies] = useState(false);

  const [activityLog, setActivityLog] = useState([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [busyActionId, setBusyActionId] = useState(null);

  const [policyModalVisible, setPolicyModalVisible] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [policyLevelInput, setPolicyLevelInput] = useState(2);
  const [categoryInput, setCategoryInput] = useState(null);
  const [experienceIdInput, setExperienceIdInput] = useState(null);
  const [partySizeMaxInput, setPartySizeMaxInput] = useState('');
  const [hoursStartInput, setHoursStartInput] = useState('');
  const [hoursEndInput, setHoursEndInput] = useState('');
  const [enabledInput, setEnabledInput] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const load = useCallback(async () => {
    if (!partnerId) return;
    try {
      const [level, ent] = await Promise.all([
        getBusinessAiTrustLevel(partnerId),
        getBusinessEntitlements(partnerId),
      ]);
      setTrustLevel(level);
      setEntitlements(ent);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setLoading(false);
  }, [partnerId]);

  const loadPolicies = useCallback(async () => {
    if (!partnerId) return;
    setLoadingPolicies(true);
    try {
      const [policyResults, expResults] = await Promise.all([
        getBusinessAiPolicies(partnerId),
        getBusinessExperiences(partnerId),
      ]);
      setPolicies(policyResults);
      setExperiences(expResults.filter((e) => e.active));
    } catch (e) {
      // Non-fatal -- the level selector above already loaded independently.
      console.error('loadPolicies failed', e);
    }
    setLoadingPolicies(false);
  }, [partnerId]);

  const loadActivityLog = useCallback(async () => {
    if (!partnerId) return;
    setLoadingLog(true);
    try {
      const rows = await getAiActivityLog(partnerId);
      setActivityLog(rows);
    } catch (e) {
      console.error('loadActivityLog failed', e);
    }
    setLoadingLog(false);
  }, [partnerId]);

  useFocusEffect(
    useCallback(() => {
      load();
      loadPolicies();
      loadActivityLog();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  function levelEntitled(feature) {
    if (!feature) return true;
    return !!(entitlements && hasEntitlement(entitlements, feature));
  }

  function handleSelectLevel(level) {
    const def = LEVELS.find((l) => l.level === level);
    if (level === trustLevel) return;

    if (def.feature && !levelEntitled(def.feature)) {
      Alert.alert(
        'Upgrade Needed',
        `${def.title} requires a plan that includes it. Your current plan doesn't.`
      );
      return;
    }

    if (level < trustLevel) {
      confirmSetLevel(level);
      return;
    }

    if (level === 3) {
      Alert.alert(
        'Enable Controlled Autopilot?',
        'Level 3 lets Nearby act automatically, without your review, inside a named policy you define for one specific scenario. It will never invent terms, change prices, or act outside that exact boundary — but real offers will go out automatically once a policy is enabled. You can turn this off, or disable any individual policy, at any time.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Yes, Enable Controlled Autopilot', style: 'destructive', onPress: () => confirmSetLevel(level) },
        ]
      );
      return;
    }

    Alert.alert(
      `Enable ${def.title}?`,
      def.description,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Enable', onPress: () => confirmSetLevel(level) },
      ]
    );
  }

  async function confirmSetLevel(level) {
    setChangingLevel(true);
    try {
      await setBusinessAiTrustLevel(partnerId, level);
      setTrustLevel(level);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setChangingLevel(false);
  }

  function openNewPolicy() {
    setEditingPolicyId(null);
    setNameInput('');
    setPolicyLevelInput(trustLevel >= 3 ? 3 : 2);
    setCategoryInput(null);
    setExperienceIdInput(experiences[0]?.id ?? null);
    setPartySizeMaxInput('');
    setHoursStartInput('');
    setHoursEndInput('');
    setEnabledInput(true);
    setPolicyModalVisible(true);
  }

  function openEditPolicy(policy) {
    setEditingPolicyId(policy.id);
    setNameInput(policy.name);
    setPolicyLevelInput(policy.trust_level);
    setCategoryInput(policy.conditions?.category ?? null);
    setExperienceIdInput(policy.conditions?.experience_id ?? null);
    setPartySizeMaxInput(policy.conditions?.party_size_max != null ? String(policy.conditions.party_size_max) : '');
    setHoursStartInput(policy.conditions?.hours_start ? String(policy.conditions.hours_start).slice(0, 5) : '');
    setHoursEndInput(policy.conditions?.hours_end ? String(policy.conditions.hours_end).slice(0, 5) : '');
    setEnabledInput(policy.enabled);
    setPolicyModalVisible(true);
  }

  async function handleSavePolicy() {
    if (!nameInput.trim()) {
      Alert.alert('Give this policy a name', 'e.g. "Coffee Date Requests" -- something naming the one real scenario it covers.');
      return;
    }
    if (!categoryInput) {
      Alert.alert('Pick a category', 'A policy needs a real category to match requests against.');
      return;
    }
    if (!experienceIdInput) {
      Alert.alert('Pick an offer template', 'A policy needs a real, already-approved Signature Experience to source its terms from.');
      return;
    }
    if (policyLevelInput === 3 && !levelEntitled('ai_level_3')) {
      Alert.alert('Upgrade Needed', 'A Level 3 policy needs a plan that includes Level 3 automation.');
      return;
    }
    if (policyLevelInput === 2 && !levelEntitled('ai_level_2')) {
      Alert.alert('Upgrade Needed', 'A Level 2 policy needs a plan that includes Level 2 automation.');
      return;
    }

    const conditions = { category: categoryInput, experience_id: experienceIdInput };
    const partySizeMax = partySizeMaxInput.trim() ? parseInt(partySizeMaxInput.trim(), 10) : null;
    if (partySizeMax != null && !Number.isNaN(partySizeMax)) conditions.party_size_max = partySizeMax;
    const hoursStart = normalizeTimeInput(hoursStartInput);
    const hoursEnd = normalizeTimeInput(hoursEndInput);
    if (hoursStart && hoursEnd) {
      conditions.hours_start = hoursStart;
      conditions.hours_end = hoursEnd;
    }

    setSavingPolicy(true);
    try {
      await upsertBusinessAiPolicy(editingPolicyId, partnerId, {
        name: nameInput.trim(),
        trustLevel: policyLevelInput,
        conditions,
        enabled: enabledInput,
      });
      setPolicyModalVisible(false);
      await loadPolicies();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSavingPolicy(false);
  }

  function handleDeletePolicy(policy) {
    Alert.alert('Delete This Policy?', `"${policy.name}" will stop auto-responding to matching requests. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteBusinessAiPolicy(policy.id);
            await loadPolicies();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  }

  async function handleUndo(actionId) {
    setBusyActionId(actionId);
    try {
      await undoAiAction(actionId);
      await loadActivityLog();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setBusyActionId(null);
  }

  function handleWithdraw(action) {
    Alert.alert(
      'Withdraw This Offer?',
      "This cancels the offer Nearby automatically sent. The person who made the request will be notified it's no longer available.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw Offer',
          style: 'destructive',
          onPress: async () => {
            setBusyActionId(action.id);
            try {
              await withdrawBusinessOffer(action.offerId);
              await loadActivityLog();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
            setBusyActionId(null);
          },
        },
      ]
    );
  }

  function renderActivityRow(action) {
    const isLevel1 = action.action_type === 'auto_apply_attribute_suggestion';
    const canUndo = isLevel1 && action.approval_result === 'auto_applied' && !action.reverted_at;
    const canWithdraw = action.action_type === 'auto_respond_offer' && action.offerStatus === 'offered';
    const busy = busyActionId === action.id;

    let bodyText;
    if (action.approval_result === 'blocked') {
      bodyText = AI_BLOCKED_REASON_LABELS[action.outcome] || action.outcome || 'Blocked.';
    } else if (isLevel1) {
      const key = action.actual_action?.attribute_key;
      const value = action.actual_action?.attribute_value;
      bodyText = key === 'category'
        ? `Set your category to "${value}."`
        : `Added "${value}" to your attributes.`;
    } else {
      bodyText = `Sent an offer for "${action.proposed_action?.experience_title || 'a Signature Experience'}."`;
    }

    return (
      <View key={action.id} style={styles.logRow}>
        <View style={styles.logRowHeader}>
          <Text style={styles.logIcon}>
            {action.approval_result === 'blocked' ? '🚫' : action.reverted_at ? '↩️' : isLevel1 ? '✏️' : '📤'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.logTitle}>{AI_ACTION_TYPE_LABELS[action.action_type] || action.action_type}</Text>
            <Text style={styles.logMeta}>
              Level {action.trust_level} · {action.risk_level} risk · {formatRelativeTime(action.created_at)}
              {action.reverted_at ? ' · undone' : ''}
            </Text>
          </View>
        </View>
        <Text style={styles.logBody}>{bodyText}</Text>
        {(canUndo || canWithdraw) && (
          <TouchableOpacity
            style={styles.logActionButton}
            onPress={() => (canUndo ? handleUndo(action.id) : handleWithdraw(action))}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={canUndo ? 'Undo this change' : 'Withdraw this offer'}
          >
            {busy ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={styles.logActionButtonText}>{canUndo ? 'Undo' : 'Withdraw Offer'}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
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
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={styles.headline}>AI Automation for {partnerName || 'Your Business'}</Text>
        <Text style={styles.subtext}>
          Choose how much Nearby is allowed to do on its own. You can raise or lower this at any
          time — nothing here ever changes prices, creates a financial commitment, or acts
          outside a rule you set.
        </Text>

        {LEVELS.map((def) => {
          const entitled = levelEntitled(def.feature);
          const selected = trustLevel === def.level;
          return (
            <TouchableOpacity
              key={def.level}
              style={[styles.levelCard, selected && styles.levelCardSelected, !entitled && styles.levelCardLocked]}
              onPress={() => handleSelectLevel(def.level)}
              disabled={changingLevel}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={def.title}
            >
              <View style={styles.levelCardHeader}>
                <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                  {selected && <View style={styles.radioInner} />}
                </View>
                <Text style={styles.levelTitle}>{def.title}</Text>
                {!entitled && <Text style={styles.lockBadge}>🔒</Text>}
              </View>
              <Text style={styles.levelDescription}>{def.description}</Text>
              {!entitled && <Text style={styles.upgradeHint}>Upgrade to unlock this level →</Text>}
            </TouchableOpacity>
          );
        })}

        {trustLevel >= 2 && (
          <>
            <View style={styles.sectionDivider} />
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>Automation Policies</Text>
              <TouchableOpacity onPress={openNewPolicy} accessibilityRole="button" accessibilityLabel="Create a new policy">
                <Text style={styles.addLink}>+ New Policy</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.sectionSubtext}>
              Each policy names one real scenario — a category, an optional party size and time
              window, and which of your Signature Experiences to auto-send. Nearby never invents
              terms outside what you set here.
            </Text>

            {loadingPolicies ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
            ) : policies.length === 0 ? (
              <Text style={styles.emptyText}>No policies yet — create one to let Level {trustLevel >= 3 ? '2 or 3' : '2'} automation actually respond to requests.</Text>
            ) : (
              policies.map((p) => {
                const exp = experiences.find((e) => e.id === p.conditions?.experience_id);
                return (
                  <View key={p.id} style={styles.policyCard}>
                    <View style={styles.policyCardHeader}>
                      <Text style={styles.policyName}>{p.name}</Text>
                      <Text style={[styles.policyStatus, p.enabled ? styles.policyStatusOn : styles.policyStatusOff]}>
                        {p.enabled ? 'ON' : 'OFF'}
                      </Text>
                    </View>
                    <Text style={styles.policyMeta}>
                      Level {p.trust_level} · {p.conditions?.category || 'any category'}
                      {p.conditions?.party_size_max ? ` · up to ${p.conditions.party_size_max} people` : ''}
                      {p.conditions?.hours_start && p.conditions?.hours_end
                        ? ` · ${String(p.conditions.hours_start).slice(0, 5)}-${String(p.conditions.hours_end).slice(0, 5)}`
                        : ''}
                    </Text>
                    <Text style={styles.policyMeta}>Sends: {exp ? exp.title : '(offer template no longer active)'}</Text>
                    <View style={styles.policyActionsRow}>
                      <TouchableOpacity onPress={() => openEditPolicy(p)} accessibilityRole="button" accessibilityLabel={`Edit ${p.name}`}>
                        <Text style={styles.policyActionText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDeletePolicy(p)} accessibilityRole="button" accessibilityLabel={`Delete ${p.name}`}>
                        <Text style={[styles.policyActionText, { color: colors.danger }]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}

        <View style={styles.sectionDivider} />
        <Text style={styles.sectionHeader}>🕓 AI Activity Log</Text>
        <Text style={styles.sectionSubtext}>
          Every real action Nearby has taken on your behalf, including what it decided not to do
          and why. Nothing here is ever silently applied without a record.
        </Text>

        {loadingLog ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
        ) : activityLog.length === 0 ? (
          <Text style={styles.emptyText}>No AI activity yet.</Text>
        ) : (
          activityLog.map(renderActivityRow)
        )}
      </ScrollView>

      <Modal visible={policyModalVisible} animationType="slide" transparent onRequestClose={() => setPolicyModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalSheet}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>{editingPolicyId ? 'Edit Policy' : 'New Policy'}</Text>

                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  style={styles.textInput}
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder='e.g. "Coffee Date Requests"'
                  placeholderTextColor={colors.textTertiary}
                />

                <Text style={styles.fieldLabel}>Automation Level</Text>
                <View style={styles.chipRow}>
                  {[2, 3].map((lvl) => (
                    <TouchableOpacity
                      key={lvl}
                      style={[styles.chip, policyLevelInput === lvl && styles.chipSelected]}
                      onPress={() => setPolicyLevelInput(lvl)}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.chipText, policyLevelInput === lvl && styles.chipTextSelected]}>Level {lvl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
                  <View style={styles.chipRow}>
                    {INTEREST_OPTIONS.map((c) => (
                      <TouchableOpacity
                        key={c}
                        style={[styles.chip, categoryInput === c && styles.chipSelected]}
                        onPress={() => setCategoryInput(c)}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.chipText, categoryInput === c && styles.chipTextSelected]}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                <Text style={styles.fieldLabel}>Send This Offer Template</Text>
                {experiences.length === 0 ? (
                  <Text style={styles.emptyText}>You have no active Signature Experiences yet — create one first on your Dashboard.</Text>
                ) : (
                  <View>
                    {experiences.map((e) => (
                      <TouchableOpacity
                        key={e.id}
                        style={[styles.experienceOption, experienceIdInput === e.id && styles.experienceOptionSelected]}
                        onPress={() => setExperienceIdInput(e.id)}
                        accessibilityRole="button"
                      >
                        <Text style={styles.experienceOptionText}>{e.title}</Text>
                        {experienceIdInput === e.id && <Text style={styles.experienceCheckmark}>✓</Text>}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <Text style={styles.fieldLabel}>Max Party Size (optional)</Text>
                <TextInput
                  style={styles.textInput}
                  value={partySizeMaxInput}
                  onChangeText={setPartySizeMaxInput}
                  placeholder="No limit"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                />

                <Text style={styles.fieldLabel}>Active Hours (optional, 24h HH:MM)</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TextInput
                    style={[styles.textInput, { flex: 1 }]}
                    value={hoursStartInput}
                    onChangeText={setHoursStartInput}
                    placeholder="17:00"
                    placeholderTextColor={colors.textTertiary}
                  />
                  <TextInput
                    style={[styles.textInput, { flex: 1 }]}
                    value={hoursEndInput}
                    onChangeText={setHoursEndInput}
                    placeholder="22:00"
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>

                <View style={styles.toggleRow}>
                  <Text style={styles.fieldLabel}>Enabled</Text>
                  <Switch value={enabledInput} onValueChange={setEnabledInput} trackColor={{ true: colors.primary }} />
                </View>

                <View style={styles.modalButtonRow}>
                  <TouchableOpacity style={styles.cancelButton} onPress={() => setPolicyModalVisible(false)}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveButton} onPress={handleSavePolicy} disabled={savingPolicy}>
                    {savingPolicy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveButtonText}>Save Policy</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headline: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  subtext: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: spacing.lg },
  levelCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  levelCardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  levelCardLocked: { opacity: 0.65 },
  levelCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: colors.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  levelTitle: { ...typography.bodyBold, color: colors.textPrimary, flex: 1 },
  lockBadge: { fontSize: 14 },
  levelDescription: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: spacing.xs, marginLeft: 28 },
  upgradeHint: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: spacing.xs, marginLeft: 28 },
  sectionDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionHeader: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 17 },
  sectionSubtext: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: spacing.xs, marginBottom: spacing.md },
  addLink: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  emptyText: { color: colors.textTertiary, fontSize: 13, fontStyle: 'italic', marginTop: spacing.xs },
  policyCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm, ...shadow.card,
  },
  policyCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  policyName: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  policyStatus: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  policyStatusOn: { color: colors.success },
  policyStatusOff: { color: colors.textTertiary },
  policyMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  policyActionsRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  policyActionText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  logRow: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  logRowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  logIcon: { fontSize: 18 },
  logTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14 },
  logMeta: { color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  logBody: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs, marginLeft: 26 },
  logActionButton: { marginTop: spacing.sm, marginLeft: 26, alignSelf: 'flex-start' },
  logActionButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, maxHeight: '85%',
  },
  modalTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  fieldLabel: { color: colors.textSecondary, fontWeight: '700', fontSize: 13, marginBottom: spacing.xs, marginTop: spacing.sm },
  textInput: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.textPrimary, fontSize: 14,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  chipTextSelected: { color: '#fff' },
  experienceOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  experienceOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  experienceOptionText: { color: colors.textPrimary, fontSize: 14 },
  experienceCheckmark: { color: colors.primary, fontWeight: '800' },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  modalButtonRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, marginBottom: spacing.md },
  cancelButton: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
  },
  cancelButtonText: { color: colors.textSecondary, fontWeight: '700' },
  saveButton: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.full, backgroundColor: colors.primary },
  saveButtonText: { color: '#fff', fontWeight: '700' },
});

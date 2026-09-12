import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getMyOccasions, addOccasion, deleteOccasion, setOccasionReminderEnabled } from '../services/occasions';
import { getMyOccasionGroupPlans } from '../services/occasionGroupPlans';
import { getMyFriends } from '../services/friends';
import { composeCelebrationTitle } from '../services/celebrateSomething';
import { OCCASION_OPTIONS, personalOccasionTypeOptions } from '../constants/businessAttributes';
import { groupOccasionsByPerson } from '../utils/occasionGrouping';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Sep 14 2026 (CLAUDE.md, "global onboarding -> product wiring" master
// plan, Phase H) -- a real Occasions CRUD screen, same shape/scope as
// EmergencyContactsScreen.js (a personal-record table, plain owner-scoped
// RLS, no RPC needed for create/delete).
//
// "Make Occasions proactive, not just user-created" (CLAUDE.md): this used
// to be its own hardcoded 6-value list, missing 5 real values the schema
// has allowed since 20261016_celebrate_occasion_vocabulary_expansion.sql
// (baby_shower/engagement/housewarming/promotion/farewell) -- a real UI
// completeness gap now that every one of them gets its own proactive
// nudge (send_occasion_planning_nudges()). Sourced from the shared
// PERSONAL_OCCASION_TYPE_KEYS list (businessAttributes.js) instead of its
// own copy, so this screen can never drift from what the table actually
// allows again.
const OCCASION_TYPES = personalOccasionTypeOptions();

// Item 62 (CLAUDE.md): "Let users save important dates for people" -- an
// "Occasions & Reminders" section grouped per person, e.g. Sarah / Birthday
// / Anniversary / Graduation. who_for_friend_id/who_for_name (added by
// 20261021_occasion_plan_linkage.sql for the wizard's own save-to-calendar
// step) previously had no UI at all on THIS screen's manual add form -- an
// occasion added here could never be grouped by person. WHO_FOR_OPTIONS
// mirrors CelebrateSomethingScreen's own vocabulary (a real connected
// friend vs. a free-typed name for anyone not on Nearby) so the two entry
// points behave the same way.
const WHO_FOR_OPTIONS = [
  { key: 'me', label: 'Me', icon: '🙋' },
  { key: 'friend', label: 'A Friend', icon: '🤝' },
  { key: 'someone_else', label: 'Someone Else', icon: '✨' },
];

function formatDate(d) {
  if (!d) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// Status copy for the "Group Plans" section below -- occasion_group_plans'
// own real status column (20261020_occasion_group_plans.sql), same
// "voting/decided/cancelled" vocabulary the RPC layer already uses.
const GROUP_PLAN_STATUS_COPY = {
  voting: 'Voting open',
  decided: 'Decided',
  cancelled: 'Cancelled',
  fulfilled: '✅ Turned into a plan',
};

export default function OccasionsScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const [occasions, setOccasions] = useState([]);
  const [groupPlans, setGroupPlans] = useState([]);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [occasionType, setOccasionType] = useState('anniversary');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [recursAnnually, setRecursAnnually] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingReminderId, setTogglingReminderId] = useState(null);

  // "Who is this for?" -- optional, but required for grouping to mean
  // anything. Defaults to 'me' (no third party named, nothing to share) --
  // the safest starting point per this item's own privacy framing.
  const [whoFor, setWhoFor] = useState('me');
  const [whoForName, setWhoForName] = useState('');
  const [whoForFriendId, setWhoForFriendId] = useState(null);
  // "The user chooses what Nearby is allowed to remember" -- naming a real
  // connected friend here is for the user's OWN organizing/grouping
  // purposes only, by default. occasions.connected_user_id (which actually
  // grants that friend visibility into this record via
  // get_upcoming_occasions) is only ever set when this is explicitly
  // checked. Defaults OFF, same posture as CelebrateSomethingScreen's own
  // matching "share this too" checkbox.
  const [shareWithFriend, setShareWithFriend] = useState(false);

  const load = useCallback(async () => {
    try {
      const [occasionsData, groupPlansData, friendsData] = await Promise.all([
        getMyOccasions(),
        getMyOccasionGroupPlans(),
        getMyFriends(),
      ]);
      setOccasions(occasionsData);
      setGroupPlans(groupPlansData);
      setFriends(friendsData);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function pickWhoFor(key) {
    setWhoFor(key);
    if (key === 'me') {
      setWhoForName('');
      setWhoForFriendId(null);
      setShareWithFriend(false);
    } else if (key === 'someone_else') {
      setWhoForFriendId(null);
      setShareWithFriend(false);
    }
    if (!titleTouched) {
      setTitle(key === 'me' ? composeCelebrationTitle({ occasion: occasionType, whoFor: 'me', whoForName: null }) : '');
    }
  }

  function pickFriend(friend) {
    setWhoFor('friend');
    setWhoForFriendId(friend.id);
    setWhoForName(friend.display_name);
    if (!titleTouched) setTitle(composeCelebrationTitle({ occasion: occasionType, whoFor: 'friend', whoForName: friend.display_name }));
  }

  function handleWhoForNameChange(text) {
    setWhoForName(text);
    if (!titleTouched) setTitle(composeCelebrationTitle({ occasion: occasionType, whoFor, whoForName: text }));
  }

  function handleOccasionTypeChange(key) {
    setOccasionType(key);
    if (!titleTouched) {
      setTitle(composeCelebrationTitle({ occasion: key, whoFor, whoForName: whoFor === 'me' ? null : whoForName }));
    }
  }

  async function handleAdd() {
    if (!title.trim()) {
      Alert.alert('Missing info', 'Give this occasion a title.');
      return;
    }
    setSubmitting(true);
    const isoDate = date.toISOString().slice(0, 10);
    const trimmedWhoForName = whoFor === 'me' ? null : whoForName.trim() || null;
    const result = await addOccasion({
      occasionType,
      title: title.trim(),
      occasionDate: isoDate,
      recursAnnually,
      whoForName: trimmedWhoForName,
      whoForFriendId: whoFor === 'friend' ? whoForFriendId : null,
      connectedUserId: whoFor === 'friend' && shareWithFriend ? whoForFriendId : null,
    });
    setSubmitting(false);
    if (result.error) {
      Alert.alert('Error', result.error);
      return;
    }
    setTitle('');
    setTitleTouched(false);
    setDate(new Date());
    setWhoFor('me');
    setWhoForName('');
    setWhoForFriendId(null);
    setShareWithFriend(false);
    load();
  }

  async function handleToggleReminder(occasion) {
    setTogglingReminderId(occasion.id);
    const nextEnabled = !occasion.reminder_enabled;
    const ok = await setOccasionReminderEnabled(occasion.id, nextEnabled);
    if (ok) {
      setOccasions((prev) => prev.map((o) => (o.id === occasion.id ? { ...o, reminder_enabled: nextEnabled } : o)));
    }
    setTogglingReminderId(null);
  }

  function confirmDelete(occasion) {
    Alert.alert(
      `Remove "${occasion.title}"?`,
      'This removes it for you. Nearby will no longer suggest planning something around it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(occasion.id);
            await deleteOccasion(occasion.id);
            setDeletingId(null);
            load();
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your occasions...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load your occasions." onRetry={load} />
      </SafeAreaView>
    );
  }

  const personGroups = groupOccasionsByPerson(occasions);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">Occasions & Reminders</Text>
          <Text style={styles.headerSubtitle}>
            Birthdays, anniversaries, graduations, and other real dates worth planning around —
            for anyone, even someone who isn't on Nearby. Only what you choose to save here —
            Nearby never infers this automatically. A connected Nearby friend's birthday is
            already handled automatically on Home, so you don't need to add it again here.
            Reminders can be turned off per occasion, any time.
          </Text>

          {groupPlans.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Group Plans</Text>
              {groupPlans.map((plan) => {
                const meta = OCCASION_OPTIONS.find((t) => t.key === plan.occasionType);
                return (
                  <TouchableOpacity
                    key={plan.id}
                    style={styles.card}
                    onPress={() => navigation.navigate('GroupOccasionPlan', { planId: plan.id })}
                    activeOpacity={0.8}
                    accessibilityLabel={plan.title}
                    accessibilityRole="button"
                  >
                    <Text style={{ fontSize: 22, marginRight: spacing.sm }}>{meta?.icon ?? '🗳️'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{plan.title}</Text>
                      <Text style={styles.detail}>
                        {GROUP_PLAN_STATUS_COPY[plan.status] ?? plan.status}{plan.isHost ? ' · Hosting' : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {occasions.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📅</Text>
              <Text style={styles.emptyText}>No occasions saved yet.</Text>
            </View>
          )}

          {personGroups.map((group) => (
            <View key={group.key} style={{ marginBottom: spacing.md }}>
              <Text style={styles.personHeader}>{group.label ? `👤 ${group.label}` : 'Other'}</Text>
              {group.occasions.map((occasion) => {
                const meta = OCCASION_TYPES.find((t) => t.key === occasion.occasion_type);
                return (
                  <View key={occasion.id} style={styles.card}>
                    <Text style={{ fontSize: 22, marginRight: spacing.sm }}>{meta?.icon ?? '📅'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>
                        {group.label ? (meta?.label ?? occasion.title) : occasion.title}
                      </Text>
                      <Text style={styles.detail}>
                        {formatDate(new Date(occasion.occasion_date + 'T00:00:00'))}
                        {occasion.recurs_annually ? ' · Repeats every year' : ' · One time'}
                        {occasion.resulting_plan_id ? ' · ✅ Planned' : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.iconButton}
                      onPress={() => handleToggleReminder(occasion)}
                      disabled={togglingReminderId === occasion.id}
                      accessibilityLabel={occasion.reminder_enabled ? `Turn off reminder for ${occasion.title}` : `Turn on reminder for ${occasion.title}`}
                      accessibilityRole="button"
                    >
                      <Text style={{ fontSize: 18 }}>{occasion.reminder_enabled ? '🔔' : '🔕'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => confirmDelete(occasion)}
                      disabled={deletingId === occasion.id}
                      accessibilityLabel={`Remove ${occasion.title}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.removeButtonText}>{deletingId === occasion.id ? '...' : 'Remove'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ))}

          <Text style={styles.sectionLabel} accessibilityRole="header">Add an occasion</Text>
          <View style={styles.form}>
            <View style={styles.chipRow}>
              {OCCASION_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.chip, occasionType === t.key && styles.chipSelected]}
                  onPress={() => handleOccasionTypeChange(t.key)}
                  accessibilityRole="button"
                  accessibilityLabel={t.label}
                >
                  <Text style={[styles.chipText, occasionType === t.key && styles.chipTextSelected]}>{t.icon} {t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Who is this for?</Text>
            <View style={styles.chipRow}>
              {WHO_FOR_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.key}
                  style={[styles.chip, whoFor === o.key && styles.chipSelected]}
                  onPress={() => pickWhoFor(o.key)}
                  accessibilityRole="button"
                  accessibilityLabel={o.label}
                >
                  <Text style={[styles.chipText, whoFor === o.key && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {whoFor === 'friend' && (
              <>
                {friends.length === 0 ? (
                  <Text style={styles.helperText}>You don't have any friends connected yet.</Text>
                ) : (
                  <View style={styles.chipRow}>
                    {friends.map((f) => (
                      <TouchableOpacity
                        key={f.id}
                        style={[styles.chip, whoForFriendId === f.id && styles.chipSelected]}
                        onPress={() => pickFriend(f)}
                        accessibilityRole="button"
                        accessibilityLabel={f.display_name}
                      >
                        <Text style={[styles.chipText, whoForFriendId === f.id && styles.chipTextSelected]}>{f.display_name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {whoForFriendId && (
                  <TouchableOpacity
                    style={styles.recurRow}
                    onPress={() => setShareWithFriend((v) => !v)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: shareWithFriend }}
                    accessibilityLabel={`Also share this with ${whoForName}`}
                  >
                    <View style={[styles.checkbox, shareWithFriend && styles.checkboxChecked]}>
                      {shareWithFriend && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
                    </View>
                    <Text style={{ color: colors.textPrimary, flex: 1 }}>👀 Also share this with {whoForName} — they'll see it on their own Occasions page too</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {whoFor === 'someone_else' && (
              <TextInput
                style={styles.input}
                placeholder="Their name (e.g. Mom)"
                placeholderTextColor={colors.textTertiary}
                value={whoForName}
                onChangeText={handleWhoForNameChange}
                accessibilityLabel="Their name"
              />
            )}

            <TextInput
              style={styles.input}
              placeholder="Title (e.g. Our Anniversary)"
              placeholderTextColor={colors.textTertiary}
              value={title}
              onChangeText={(text) => { setTitle(text); setTitleTouched(true); }}
              accessibilityLabel="Occasion title"
            />
            <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)} accessibilityRole="button" accessibilityLabel="Occasion date">
              <Text style={{ color: colors.textPrimary }}>{formatDate(date)}</Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={date}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                themeVariant={isDark ? 'dark' : 'light'}
                onChange={(event, selectedDate) => {
                  setShowDatePicker(Platform.OS === 'ios');
                  if (selectedDate) setDate(selectedDate);
                }}
              />
            )}
            <TouchableOpacity
              style={styles.recurRow}
              onPress={() => setRecursAnnually((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Repeats every year"
            >
              <View style={[styles.checkbox, recursAnnually && styles.checkboxChecked]}>
                {recursAnnually && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
              </View>
              <Text style={{ color: colors.textPrimary }}>Repeats every year</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addButton} onPress={handleAdd} disabled={submitting} activeOpacity={0.85}>
              <Text style={styles.addButtonText}>{submitting ? 'Adding...' : 'Add Occasion'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingVertical: spacing.lg },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
  personHeader: { ...typography.bodyBold, color: colors.textPrimary, marginBottom: spacing.xs, fontSize: 15 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  detail: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  iconButton: { paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  removeButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  removeButtonText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.xs },
  helperText: { color: colors.textTertiary, fontSize: 12, marginBottom: spacing.sm },
  form: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated,
  },
  chipSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13 },
  chipTextSelected: { color: colors.primary, fontWeight: '700' },
  input: {
    backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.md,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
    justifyContent: 'center', minHeight: 44,
  },
  recurRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, paddingVertical: spacing.xs },
  checkbox: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.xs },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import FadeInState from '../components/FadeInState';
import BrandedLoader from '../components/BrandedLoader';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getMyOccasions, addOccasion, deleteOccasion, setOccasionReminderEnabled, setOccasionRecallShareable, revealOccasion } from '../services/occasions';
import { getMyOccasionGroupPlans } from '../services/occasionGroupPlans';
import { getMyFriends } from '../services/friends';
import { composeCelebrationTitle } from '../services/celebrateSomething';
import { OCCASION_OPTIONS, personalOccasionTypeOptions, personalOccasionTypeGroupOptions } from '../constants/businessAttributes';
import { groupOccasionsByPerson } from '../utils/occasionGrouping';
import { describeOccasionPrivacy } from '../utils/occasionVisibility';
import {
  OCCASION_DATE_PRECISION_OPTIONS,
  normalizeOccasionDateForPrecision,
  formatOccasionDateForPrecision,
} from '../utils/occasionDatePrecision';
import {
  isCalendarIntegrationSupported,
  requestCalendarPermission,
  listDeviceCalendars,
  getSelectedCalendarIds,
  setSelectedCalendarIds,
  clearSelectedCalendarIds,
  getDismissedCalendarEventIds,
  markCalendarEventHandled,
  isCalendarIntegrationEnabled,
  getUpcomingCalendarEvents,
} from '../services/deviceCalendar';
import { guessOccasionTypeFromEventTitle, formatCalendarEventDateLabel, filterUpcomingCalendarSuggestions } from '../utils/calendarOccasionSuggestion';
import LoadErrorState from '../components/LoadErrorState';
import { SurpriseRevealAnimation } from '../motion';
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
  // Item 98 (CLAUDE.md, "Don't require exact dates"): "Her birthday is
  // sometime next month" is a completely normal thing to know. Defaults to
  // 'exact' -- the safest, most useful default for anyone who does know
  // the real day, same posture as every other default-on-the-common-case
  // choice in this screen (e.g. whoFor defaulting to 'me').
  const [datePrecision, setDatePrecision] = useState('exact');
  const [recursAnnually, setRecursAnnually] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingReminderId, setTogglingReminderId] = useState(null);
  const [revealingId, setRevealingId] = useState(null);
  // Item 112 follow-up (CLAUDE.md, "do same reveal for occasions screen"):
  // set only after the real reveal_occasion RPC has already succeeded --
  // same "never a speculative reveal" discipline as GroupOccasionPlanScreen's
  // own version of this animation.
  const [revealAnimatingId, setRevealAnimatingId] = useState(null);
  const [togglingRecallShareId, setTogglingRecallShareId] = useState(null);

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
  // Item 65 (CLAUDE.md, direct user request): "Let the organizer keep the
  // occasion private... The birthday person should not automatically see:
  // Allen is planning your birthday." Only meaningful once a real
  // connected friend is picked -- there's nothing on Nearby to hide from
  // someone with no account. Forces shareWithFriend off (also a hard DB
  // constraint, occasions_surprise_no_share_check).
  const [surpriseMode, setSurpriseMode] = useState(false);

  // Item 75 (CLAUDE.md): "Connect occasions to the user's calendar" --
  // permission-driven (never blanket access), read-only, with a hard
  // structural distinction between private calendar info (calendarEvents
  // below, read live from the device, never uploaded) and a real Nearby
  // Occasion (only created when the user explicitly taps an action). See
  // src/services/deviceCalendar.js's own header comment for the full
  // privacy boundary.
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [loadingCalendarEvents, setLoadingCalendarEvents] = useState(false);
  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [availableCalendars, setAvailableCalendars] = useState([]);
  const [pickerSelectedIds, setPickerSelectedIds] = useState(() => new Set());
  const [handlingEventId, setHandlingEventId] = useState(null);

  const loadCalendarSection = useCallback(async () => {
    if (!isCalendarIntegrationSupported()) return;
    const enabled = await isCalendarIntegrationEnabled();
    setCalendarEnabled(enabled);
    if (!enabled) {
      setCalendarEvents([]);
      return;
    }
    setLoadingCalendarEvents(true);
    const [events, dismissed] = await Promise.all([getUpcomingCalendarEvents(60), getDismissedCalendarEventIds()]);
    setCalendarEvents(filterUpcomingCalendarSuggestions(events, dismissed));
    setLoadingCalendarEvents(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCalendarSection();
    }, [loadCalendarSection])
  );

  function handleConnectCalendarPress() {
    Alert.alert(
      'Allow Nearby to use selected calendar events to help you plan?',
      "Nearby will only see events from calendars you choose to share. It can never edit, add, or share anything on your calendar.",
      [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Continue', onPress: requestAndPickCalendars },
      ]
    );
  }

  async function requestAndPickCalendars() {
    setConnectingCalendar(true);
    const status = await requestCalendarPermission();
    setConnectingCalendar(false);
    if (status !== 'granted') {
      Alert.alert('Calendar access is off', 'You can turn it on any time from your device Settings.');
      return;
    }
    await openCalendarPicker();
  }

  async function openCalendarPicker() {
    const calendars = await listDeviceCalendars();
    setAvailableCalendars(calendars);
    const currentIds = await getSelectedCalendarIds();
    setPickerSelectedIds(new Set(currentIds));
    setShowCalendarPicker(true);
  }

  function togglePickerCalendar(id) {
    setPickerSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function saveCalendarSelection() {
    await setSelectedCalendarIds(Array.from(pickerSelectedIds));
    setShowCalendarPicker(false);
    await loadCalendarSection();
  }

  function confirmDisconnectCalendar() {
    Alert.alert(
      'Disconnect calendar?',
      "Nearby will stop looking at your calendar events. This doesn't change your device's own calendar permission -- you can fully revoke that any time in your device Settings.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await clearSelectedCalendarIds();
            await loadCalendarSection();
          },
        },
      ]
    );
  }

  // "Save as Occasion": a lightweight, explicit tracking action -- creates
  // a real Occasion (with a reminder, per Items 62/63), never anything
  // more. Does not navigate anywhere -- the point is remembering, not
  // planning yet.
  async function handleSaveEventAsOccasion(event) {
    setHandlingEventId(event.id);
    const isoDate = new Date(event.startDate).toISOString().slice(0, 10);
    const result = await addOccasion({
      occasionType: guessOccasionTypeFromEventTitle(event.title),
      title: event.title,
      occasionDate: isoDate,
      recursAnnually: false,
      importedFromCalendar: true,
    });
    if (result.error) {
      Alert.alert('Error', result.error);
      setHandlingEventId(null);
      return;
    }
    await markCalendarEventHandled(event.id);
    setCalendarEvents((prev) => prev.filter((e) => e.id !== event.id));
    setHandlingEventId(null);
    load();
  }

  // "Plan Something →": the user's own example ("Dad's visiting -- want to
  // take him somewhere special") -- lands directly on Item 74's Custom
  // Occasion Describe step, prefilled with the real event title, which
  // Nearby then classifies + resolves the same way Home's ask box does.
  // Deliberately does not also create an Occasion row here (that's the
  // separate, explicit "Save as Occasion" action above) -- this is about
  // planning right now, not record-keeping.
  async function handlePlanFromEvent(event) {
    setHandlingEventId(event.id);
    await markCalendarEventHandled(event.id);
    setCalendarEvents((prev) => prev.filter((e) => e.id !== event.id));
    setHandlingEventId(null);
    navigation.navigate('CelebrateSomething', { initialOccasion: 'other', initialCustomDescription: event.title });
  }

  async function handleDismissEvent(event) {
    setHandlingEventId(event.id);
    await markCalendarEventHandled(event.id);
    setCalendarEvents((prev) => prev.filter((e) => e.id !== event.id));
    setHandlingEventId(null);
  }

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
      setSurpriseMode(false);
    } else if (key === 'someone_else') {
      setWhoForFriendId(null);
      setShareWithFriend(false);
      setSurpriseMode(false);
    }
    if (!titleTouched) {
      setTitle(key === 'me' ? composeCelebrationTitle({ occasion: occasionType, whoFor: 'me', whoForName: null }) : '');
    }
  }

  function pickFriend(friend) {
    setWhoFor('friend');
    setWhoForFriendId(friend.id);
    setWhoForName(friend.display_name);
    setShareWithFriend(false);
    setSurpriseMode(false);
    if (!titleTouched) setTitle(composeCelebrationTitle({ occasion: occasionType, whoFor: 'friend', whoForName: friend.display_name }));
  }

  function toggleSurpriseMode() {
    setSurpriseMode((v) => {
      const next = !v;
      if (next) setShareWithFriend(false);
      return next;
    });
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
    const isoDate = normalizeOccasionDateForPrecision(datePrecision, date);
    const trimmedWhoForName = whoFor === 'me' ? null : whoForName.trim() || null;
    const result = await addOccasion({
      occasionType,
      title: title.trim(),
      occasionDate: isoDate,
      datePrecision,
      recursAnnually,
      whoForName: trimmedWhoForName,
      whoForFriendId: whoFor === 'friend' ? whoForFriendId : null,
      connectedUserId: whoFor === 'friend' && shareWithFriend ? whoForFriendId : null,
      surpriseMode: whoFor === 'friend' && surpriseMode,
    });
    setSubmitting(false);
    if (result.error) {
      Alert.alert('Error', result.error);
      return;
    }
    setTitle('');
    setTitleTouched(false);
    setDate(new Date());
    setDatePrecision('exact');
    setWhoFor('me');
    setWhoForName('');
    setWhoForFriendId(null);
    setShareWithFriend(false);
    setSurpriseMode(false);
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

  // Item 102 (CLAUDE.md, "Businesses can participate in recurring
  // occasions"): the real, durable place to control this consent, since
  // Home's own recall card only shows up the day it fires. Default OFF,
  // never inferred -- see setOccasionRecallShareable's own header comment.
  async function handleToggleRecallShare(occasion) {
    setTogglingRecallShareId(occasion.id);
    const next = !occasion.recall_shareable_with_business;
    const ok = await setOccasionRecallShareable(occasion.id, next);
    if (ok) {
      setOccasions((prev) => prev.map((o) => (o.id === occasion.id ? { ...o, recall_shareable_with_business: next } : o)));
    }
    setTogglingRecallShareId(null);
  }

  // Item 96 (CLAUDE.md, "Add surprise mode... Eventually: Reveal plan
  // becomes an action"): a real, one-way action -- when a real connected
  // friend is attached, this also turns ON sharing with them server-side
  // (reveal_occasion), so confirm before firing.
  function confirmReveal(occasion) {
    Alert.alert(
      'Reveal the surprise?',
      occasion.who_for_name
        ? `${occasion.who_for_name} will be able to see this occasion — this can't be undone.`
        : "This occasion will stop being marked as a surprise — this can't be undone.",
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Reveal',
          onPress: async () => {
            setRevealingId(occasion.id);
            try {
              await revealOccasion(occasion.id);
              // Item 112 follow-up: the animation starts only once the
              // real reveal has already happened server-side -- the row's
              // own surprise_mode flip is deferred to handleRevealAnimationDone
              // so it doesn't unmount the animation mid-play.
              setRevealAnimatingId(occasion.id);
            } catch (e) {
              Alert.alert('Something went wrong', e.message);
            }
            setRevealingId(null);
          },
        },
      ]
    );
  }

  function handleRevealAnimationDone(occasionId) {
    setRevealAnimatingId(null);
    setOccasions((prev) => prev.map((o) => (o.id === occasionId ? { ...o, surprise_mode: false } : o)));
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
        <BrandedLoader fullScreen={false} />
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

          {isCalendarIntegrationSupported() && (
            <View style={{ marginBottom: spacing.md }}>
              {!calendarEnabled ? (
                <TouchableOpacity
                  style={styles.card}
                  onPress={handleConnectCalendarPress}
                  disabled={connectingCalendar}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Connect your calendar"
                >
                  <Text style={{ fontSize: 22, marginRight: spacing.sm }}>📅</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{connectingCalendar ? 'Connecting…' : 'Connect Your Calendar'}</Text>
                    <Text style={styles.detail}>Let Nearby quietly suggest occasions from events on calendars you choose to share.</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <>
                  <View style={styles.calendarSectionHeaderRow}>
                    <Text style={styles.sectionLabel}>From Your Calendar</Text>
                    <View style={{ flexDirection: 'row', gap: spacing.md }}>
                      <TouchableOpacity onPress={openCalendarPicker} accessibilityRole="button" accessibilityLabel="Manage which calendars are shared">
                        <Text style={styles.calendarManageLink}>Manage</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={confirmDisconnectCalendar} accessibilityRole="button" accessibilityLabel="Disconnect calendar">
                        <Text style={[styles.calendarManageLink, { color: colors.danger }]}>Disconnect</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <Text style={styles.helperText}>
                    Only the calendars you picked are read. Nearby never edits your calendar -- event
                    details stay on this device unless you choose to act on one below.
                  </Text>
                  {loadingCalendarEvents ? (
                    <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
                  ) : calendarEvents.length === 0 ? (
                    <Text style={styles.helperText}>Nothing new on your shared calendars right now.</Text>
                  ) : (
                    calendarEvents.map((event) => {
                      const guessedType = guessOccasionTypeFromEventTitle(event.title);
                      const meta = OCCASION_TYPES.find((t) => t.key === guessedType);
                      const busy = handlingEventId === event.id;
                      return (
                        <View key={event.id} style={styles.card}>
                          <Text style={{ fontSize: 22, marginRight: spacing.sm }}>{meta?.icon ?? '📅'}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.name}>{event.title}</Text>
                            <Text style={styles.detail}>{formatCalendarEventDateLabel(event.startDate)}</Text>
                            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs, flexWrap: 'wrap' }}>
                              <TouchableOpacity disabled={busy} onPress={() => handlePlanFromEvent(event)} accessibilityRole="button" accessibilityLabel={`Plan something for ${event.title}`}>
                                <Text style={styles.calendarActionPrimary}>Plan Something →</Text>
                              </TouchableOpacity>
                              <TouchableOpacity disabled={busy} onPress={() => handleSaveEventAsOccasion(event)} accessibilityRole="button" accessibilityLabel={`Save ${event.title} as an occasion`}>
                                <Text style={styles.calendarManageLink}>Save as Occasion</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                          <TouchableOpacity
                            style={styles.iconButton}
                            disabled={busy}
                            onPress={() => handleDismissEvent(event)}
                            accessibilityLabel={`Not relevant: ${event.title}`}
                            accessibilityRole="button"
                          >
                            <Text style={{ fontSize: 16, color: colors.textTertiary }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}
                </>
              )}
            </View>
          )}

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
                      <Text style={styles.name}>{plan.surpriseMode ? '🔒 ' : ''}{plan.title}</Text>
                      <Text style={styles.detail}>
                        {GROUP_PLAN_STATUS_COPY[plan.status] ?? plan.status}{plan.isHost ? ' · Hosting' : ''}
                      </Text>
                      {/* Item 109 (CLAUDE.md, "make the visibility model
                          explicit"): a group plan is always invite-only by
                          construction (zero client RLS policies, RPC-gated
                          to the host and invited participants) -- say so. */}
                      <Text style={styles.privacyLine}>🔒 Invite-only</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {occasions.length === 0 && (
            <FadeInState style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📅</Text>
              <Text style={styles.emptyText}>No occasions saved yet.</Text>
            </FadeInState>
          )}

          {personGroups.map((group) => (
            <View key={group.key} style={{ marginBottom: spacing.md }}>
              <Text style={styles.personHeader}>{group.label ? `👤 ${group.label}` : 'Other'}</Text>
              {group.occasions.map((occasion) => {
                const meta = OCCASION_TYPES.find((t) => t.key === occasion.occasion_type);
                return (
                  <View key={occasion.id} style={styles.card}>
                    {revealAnimatingId === occasion.id ? (
                      // Item 112 follow-up (CLAUDE.md, "do same reveal for
                      // occasions screen"): the animation replaces the
                      // row's whole content, same "already-real, never
                      // speculative" reveal discipline as
                      // GroupOccasionPlanScreen's own version.
                      <View style={{ flex: 1 }}>
                        <SurpriseRevealAnimation
                          text={`🎉 ${occasion.who_for_name || 'They'} can see it now!`}
                          onDone={() => handleRevealAnimationDone(occasion.id)}
                        />
                      </View>
                    ) : (
                      <>
                        <Text style={{ fontSize: 22, marginRight: spacing.sm }}>{meta?.icon ?? '📅'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.name}>
                            {occasion.surprise_mode ? '🔒 ' : ''}{group.label ? (meta?.label ?? occasion.title) : occasion.title}
                          </Text>
                          <Text style={styles.detail}>
                            {formatOccasionDateForPrecision(occasion.date_precision, occasion.occasion_date)}
                            {occasion.recurs_annually ? ' · Repeats every year' : ' · One time'}
                            {occasion.resulting_plan_id ? ' · ✅ Planned' : ''}
                            {occasion.imported_from_calendar ? ' · 📅 From your calendar' : ''}
                          </Text>
                          {/* Item 109 (CLAUDE.md, "make the visibility model
                              explicit"): who can actually see this record --
                              always Private, or Shared with one explicitly
                              picked person, never anything broader. */}
                          <Text style={styles.privacyLine}>
                            {describeOccasionPrivacy(occasion).icon} {describeOccasionPrivacy(occasion).label}
                          </Text>
                          {/* Item 96 ("Add surprise mode"): "Eventually: Reveal
                              plan becomes an action" -- a real, one-way tap. */}
                          {occasion.surprise_mode && (
                            <TouchableOpacity
                              onPress={() => confirmReveal(occasion)}
                              disabled={revealingId === occasion.id}
                              activeOpacity={0.8}
                              accessibilityRole="button"
                              accessibilityLabel={`Reveal the surprise for ${occasion.title}`}
                            >
                              <Text style={styles.revealLink}>
                                {revealingId === occasion.id ? 'Revealing…' : '🎁 Reveal Plan'}
                              </Text>
                            </TouchableOpacity>
                          )}
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
                        {/* Item 102: only meaningful once there's real
                            recurring history a business could ever recognize
                            -- a plan that turned out to be gathering-destined
                            (no business) just means consenting has no real
                            effect, never a privacy leak either way. */}
                        {occasion.recurs_annually && occasion.resulting_plan_id && (
                          <TouchableOpacity
                            style={styles.iconButton}
                            onPress={() => handleToggleRecallShare(occasion)}
                            disabled={togglingRecallShareId === occasion.id}
                            accessibilityLabel={occasion.recall_shareable_with_business ? `Stop letting businesses recognize you for ${occasion.title}` : `Let a business recognize you for ${occasion.title}`}
                            accessibilityRole="button"
                          >
                            <Text style={{ fontSize: 18 }}>{occasion.recall_shareable_with_business ? '🏪' : '🚫'}</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.removeButton}
                          onPress={() => confirmDelete(occasion)}
                          disabled={deletingId === occasion.id}
                          accessibilityLabel={`Remove ${occasion.title}`}
                          accessibilityRole="button"
                        >
                          <Text style={styles.removeButtonText}>{deletingId === occasion.id ? '...' : 'Remove'}</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                );
              })}
            </View>
          ))}

          <Text style={styles.sectionLabel} accessibilityRole="header">Add an occasion</Text>
          <View style={styles.form}>
            {/* Item 73 (CLAUDE.md): real grouped sections instead of one
                long flat chip row -- same architecture the Occasion
                wizard's own occasion step uses, so this screen (built for
                "anyone, including someone not on Nearby") never falls
                behind as the vocabulary grows. */}
            {personalOccasionTypeGroupOptions().map((group) => (
              <View key={group.key} style={{ marginBottom: spacing.sm }}>
                <Text style={styles.fieldLabel}>{group.label}</Text>
                <View style={styles.chipRow}>
                  {group.options.map((t) => (
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
              </View>
            ))}

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
                  <>
                    <TouchableOpacity
                      style={styles.recurRow}
                      onPress={toggleSurpriseMode}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: surpriseMode }}
                      accessibilityLabel={`Surprise mode — keep this hidden from ${whoForName}`}
                    >
                      <View style={[styles.checkbox, surpriseMode && styles.checkboxChecked]}>
                        {surpriseMode && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
                      </View>
                      <Text style={{ color: colors.textPrimary, flex: 1 }}>🔒 Surprise mode — keep this hidden from {whoForName}</Text>
                    </TouchableOpacity>

                    {surpriseMode ? (
                      <Text style={styles.helperText}>This won't be shared with {whoForName} or shown to them anywhere in Nearby.</Text>
                    ) : (
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
            {/* Item 98 (CLAUDE.md, "Don't require exact dates"): "Her
                birthday is sometime next month" is a completely normal
                thing to know -- the picker below still returns one real
                day (it has no other mode), but this controls how that
                pick gets INTERPRETED before it's saved (see
                occasionDatePrecision.js). */}
            <Text style={styles.fieldLabel}>How well do you know the date?</Text>
            <View style={styles.chipRow}>
              {OCCASION_DATE_PRECISION_OPTIONS.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.chip, datePrecision === p.key && styles.chipSelected]}
                  onPress={() => setDatePrecision(p.key)}
                  accessibilityRole="button"
                  accessibilityLabel={p.label}
                  accessibilityState={{ selected: datePrecision === p.key }}
                >
                  <Text style={[styles.chipText, datePrecision === p.key && styles.chipTextSelected]}>{p.icon} {p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)} accessibilityRole="button" accessibilityLabel="Occasion date">
              <Text style={{ color: colors.textPrimary }}>{formatDate(date)}</Text>
            </TouchableOpacity>
            {datePrecision !== 'exact' && (
              <Text style={styles.helperText}>
                {datePrecision === 'flexible'
                  ? 'Only the month matters -- pick any day in it.'
                  : datePrecision === 'weekend'
                  ? "We'll round this to that week's Saturday."
                  : "We'll save this as your best guess."}
                {' '}Will show as "{formatOccasionDateForPrecision(datePrecision, normalizeOccasionDateForPrecision(datePrecision, date))}".
              </Text>
            )}
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

      <Modal
        visible={showCalendarPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCalendarPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalSheet}>
            <Text style={styles.headerTitle}>Which calendars can Nearby use?</Text>
            <Text style={styles.headerSubtitle}>Only checked calendars will ever be read. Nothing is shared or edited.</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {availableCalendars.length === 0 ? (
                <Text style={styles.helperText}>No calendars found on this device.</Text>
              ) : (
                availableCalendars.map((cal) => {
                  const checked = pickerSelectedIds.has(cal.id);
                  return (
                    <TouchableOpacity
                      key={cal.id}
                      style={styles.recurRow}
                      onPress={() => togglePickerCalendar(cal.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={cal.title}
                    >
                      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                        {checked && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
                      </View>
                      <Text style={{ color: colors.textPrimary, flex: 1 }}>{cal.title}{cal.source ? ` (${cal.source})` : ''}</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            <TouchableOpacity style={styles.addButton} onPress={saveCalendarSelection} activeOpacity={0.85}>
              <Text style={styles.addButtonText}>Save Selection</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', marginTop: spacing.sm, paddingVertical: spacing.sm }} onPress={() => setShowCalendarPicker(false)} accessibilityRole="button" accessibilityLabel="Cancel">
              <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>
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
  privacyLine: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  // Item 112 follow-up: colors.surprise (theme.js), not colors.primary --
  // matches GroupOccasionPlanScreen's own surprise-mode visual language.
  revealLink: { color: colors.surprise, fontSize: 12, fontWeight: '700', marginTop: 4 },
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
  calendarSectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  calendarManageLink: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  calendarActionPrimary: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, paddingBottom: spacing.xl,
  },
});

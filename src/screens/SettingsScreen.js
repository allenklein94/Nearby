import React, { useEffect, useRef, useState } from 'react';
import { PERKS_TAB } from '../utils/recommendationContext';
import { navigateKeepingTrail } from '../services/openDestination';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, ScrollView, Switch, Linking, Platform, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../services/supabase';
import { visibleSettingsSections, groupTextKeys, toggleGroup } from '../constants/notificationPreferences';
import { setMyNotificationGroup } from '../services/notificationPrefs';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { deleteAccount } from '../services/account';
import { requestDataExport } from '../services/dataExport';
import { clearNotificationArea } from '../services/notificationArea';
import { clearMyBehaviorHistory, getMyBehaviorCategories, forgetBehaviorCategory, addLearnedInterestToProfile, removeAddedInterestFromProfile } from '../services/behaviorSignals';
import { learnedAffinities } from '../utils/learnedAffinity';
import { usualTripRows } from '../utils/learnedProximity';
import { getMyLearnedProximity, resetLearnedProximityCache } from '../services/learnedProximity';
import RecommendationCustomizePanel from '../components/RecommendationCustomizePanel';
import { ONBOARDING_INTEREST_GROUPS, sanitizeInterestGroups } from '../constants/interestGraph';
import { ONBOARDING_GOALS, goalLabelsFrom, motivationsWithGoals } from '../constants/onboardingGoals';
import { groupName, categoryName } from '../i18n/categoryNames';
import { localDistance } from '../i18n/format';
import { typography, spacing, radius } from '../theme';

import { showSuccessToast } from '../motion';
import { clearHiddenSponsors } from '../services/sponsored';
function toE164(rawInput) {
  const digits = rawInput.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// IA restructure round 3, Phase 6: regrouped into 6 named control-center
// sections (Account / Preferences / Notifications / Privacy & Safety /
// Business / Support), matching round 2 Phase 5's own "reuse every
// existing row, add new headers, don't rebuild content" precedent —
// every row below is the exact same content/handler as before, just
// physically regrouped and relabeled. Two placements the plan itself
// flagged as unresolved, and two gaps the plan's own text didn't
// anticipate, resolved here (see CLAUDE.md's Phase 6 status note for the
// full reasoning):
// - "Connect" (Friends/Music Mode/Invite Friends) stays its own header,
//   deliberately outside the 6 — it's product-feature access, not an
//   app control, and doesn't map cleanly to any of the 6. "Offers &
//   Perks" (previously under "Account & Billing", never addressed by the
//   plan's own mapping) joins it for the same reason.
// - "❤️ Relationship" moves from Safety into Connect — it's relationship
//   tools/reflection, not a safety feature; Safety keeps only genuine
//   safety rows.
// - "Business" here is admin-only rows now (Business Dashboard/Requests/
//   Review Verifications) — the plan's own text assumed a personal
//   "Business" row still lived in Settings, but round 2 Phase 7 already
//   moved that to Profile; nothing to fold in here anymore.
// - "Review Reports (Admin)" (a 4th admin row the plan never named) goes
//   into Privacy & Safety's Safety sub-group — it's content-moderation/
//   safety-complaint review, not a business concern.
//
// Aug 28 2026, Phase 3 of the "build everything" plan (progressive/
// contextual settings): the always-visible "Friend Discovery" toggle was
// removed from this screen outright -- it's now asked for the first time
// contextually inside FriendDiscoveryScreen.js itself (that screen's own
// pre-existing "Turn On" explainer state), reached via Discover's "Meet
// New Friends" card, not from here. "Looking For"/"Discovery Preferences"
// below are unchanged and still fully editable here -- Phase 3 only added
// an *earlier*, contextual first ask inside DiscoveryScreen.js for a user
// who opens Dating before ever visiting Settings; it didn't remove
// anything from this screen.
// Relationship tools, shown as a Settings section (rule 14; formerly the RelationshipHub screen). Labels: ui.relationship.hub.*.
// The tools shared with a match live only in that match's chat ("Do Something Together"); this section says where, with no
// link of its own (the RelationshipTools pick-a-match screen was a duplicate of that menu and is removed, rule 14).
const RELATIONSHIP_SECTIONS = [
  { key: 'together', rows: [], whereKey: 'ui.relationship.hub.together.where' },
  { key: 'onYourOwn', rows: [
    { key: 'rehearsal', icon: '🎭', route: 'RehearsalRoom' },
    { key: 'chemistry', icon: '📔', route: 'ChemistryDiaryList' },
    { key: 'goodbye', icon: '🌙', route: 'GoodbyeArchiveList' },
    { key: 'legacy', icon: '💌', route: 'LegacyLibrary' },
    { key: 'kit', icon: '🧰', route: 'RelationshipEmergencyKit' },
  ] },
];

export default function SettingsScreen({ navigation, route }) {
  const { isAdmin } = useAuth();
  const { colors, shadow, isDark, toggleTheme } = useTheme();
  const { t, language, setLanguage } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [userId, setUserId] = useState(null);
  const [discoveryViewStyle, setDiscoveryViewStyle] = useState('list');
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(true);
  const [shareInterestInDemand, setShareInterestInDemand] = useState(true);
  const [showSponsoredPlaces, setShowSponsoredPlaces] = useState(true);
  const [womenMessageFirst, setWomenMessageFirst] = useState(false);
  const [intentVisibility, setIntentVisibility] = useState('friends_and_matches');

  // Item 142: notification choices are groups the person turned off (profiles.notification_mutes), one switch per group,
  // grouped by area (constants/notificationPreferences.js). Applied centrally by the server's push sender.
  const [notificationMutes, setNotificationMutes] = useState([]);
  // Item 143: a business owner also sees 'Your business' (operational alerts), separate from 'Businesses you use'.
  const [isBusinessOwner, setIsBusinessOwner] = useState(false);
  const [osNotifPermission, setOsNotifPermission] = useState('granted');

  // External UX critique item 17 follow-up (2026-09-11): the "this matches
  // you" push controls used to be their own navigation destination
  // (RecommendationPreferencesScreen). Per direct product direction --
  // "fewer screens, not more; put a preference where the user encounters
  // the thing it controls" -- that screen is gone. These 4 fields per
  // category are now an inline expand-in-place panel
  // (RecommendationCustomizePanel) right under each row's own toggle,
  // expandedRecPanel holding which one (if any) is open.
  const [expandedRecPanel, setExpandedRecPanel] = useState(null); // null | 'things_to_do' | 'nearby_opportunities'
  const [myInterests, setMyInterests] = useState([]);
  // Item 95: what Nearby has learned from activity (ranking only), shown back with Forget / Add to my interests.
  const [behaviorRows, setBehaviorRows] = useState([]);
  const learned = learnedAffinities(behaviorRows, myInterests);
  const [usualTrips, setUsualTrips] = useState([]);
  const loadUsualTrips = () => { resetLearnedProximityCache(); return getMyLearnedProximity().then((m) => setUsualTrips(usualTripRows(m))).catch(() => setUsualTrips([])); };
  const loadLearned = () => { loadUsualTrips(); return getMyBehaviorCategories().then(setBehaviorRows).catch(() => setBehaviorRows([])); };
  const [ttdFrequency, setTtdFrequency] = useState('few_per_day');
  const [ttdDistance, setTtdDistance] = useState(15);
  const [ttdTimePref, setTtdTimePref] = useState('anytime');
  const [ttdCategories, setTtdCategories] = useState(null); // null = all of myInterests qualify
  const [noFrequency, setNoFrequency] = useState('few_per_day');
  const [noDistance, setNoDistance] = useState(15);
  const [noTimePref, setNoTimePref] = useState('anytime');
  const [noCategories, setNoCategories] = useState(null);

  const [changingPhone, setChangingPhone] = useState(false);
  const [newPhoneInput, setNewPhoneInput] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [e164NewPhone, setE164NewPhone] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const scrollRef = useRef(null);
  const preferencesYRef = useRef(0);

  useEffect(() => {
    load();
    checkOsPermission();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkOsPermission();
    });
    return () => subscription.remove();
  }, []);

  // Aug 27 2026 plan (CLAUDE.md), Decision 7: Profile's new "Preferences ->"
  // row lands here, scrolled straight to the Preferences group instead of
  // the top of Settings -- same "wait a beat for layout, then scroll"
  // pattern ProfileScreen's own scrollToGenderSection already established.
  useEffect(() => {
    if (route?.params?.scrollToPreferences) {
      const timer = setTimeout(() => {
        scrollRef.current?.scrollTo({ y: preferencesYRef.current, animated: true });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [route?.params?.scrollToPreferences]);

  async function checkOsPermission() {
    const { status } = await Notifications.getPermissionsAsync();
    setOsNotifPermission(status);
  }

  function openSystemSettings() {
    Linking.openSettings();
  }

  const [motivations, setMotivations] = useState([]);

  const [interestGroups, setInterestGroups] = useState([]);

  // Broad interest groups: independent of specific tags (removing one never touches your tags, adding one never adds any).
  async function toggleInterestGroup(key) {
    const previous = interestGroups;
    const next = sanitizeInterestGroups(previous.includes(key) ? previous.filter((k) => k !== key) : [...previous, key]);
    setInterestGroups(next);
    const { error } = await supabase.from('profiles').update({ interest_groups: next }).eq('id', userId);
    if (error) {
      setInterestGroups(previous);
      presentRecoverableError(Alert, { what: 'complete that', error: error, onRetry: () => toggleInterestGroup(key) });
    }
  }

  async function toggleGoal(label) {
    const has = motivations.includes(label);
    const next = motivationsWithGoals(motivations, has ? goalLabelsFrom(motivations).filter((l) => l !== label) : [...goalLabelsFrom(motivations), label]);
    const previous = motivations;
    setMotivations(next);
    const { error } = await supabase.from('profiles').update({ onboarding_motivations: next }).eq('id', userId);
    if (error) {
      setMotivations(previous);
      presentRecoverableError(Alert, { what: 'complete that', error: error, onRetry: () => toggleGoal(label) });
    }
  }

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    const id = sessionData?.session?.user?.id;
    setUserId(id);

    const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
    if (data) {
      setNotificationMutes(data.notification_mutes ?? []);
      setIsBusinessOwner(!!data.managed_partner_id);
      setMyInterests(data.interests ?? []);
      loadLearned();
      setMotivations(data.onboarding_motivations ?? []);
      setInterestGroups(data.interest_groups ?? []);
      setTtdFrequency(data.notify_things_to_do_frequency ?? 'few_per_day');
      setTtdDistance(data.notify_things_to_do_max_distance_miles === undefined ? 15 : data.notify_things_to_do_max_distance_miles);
      setTtdTimePref(data.notify_things_to_do_time_pref ?? 'anytime');
      setTtdCategories(data.notify_things_to_do_categories ?? null);
      setNoFrequency(data.notify_nearby_opportunities_frequency ?? 'few_per_day');
      setNoDistance(data.notify_nearby_opportunities_max_distance_miles === undefined ? 15 : data.notify_nearby_opportunities_max_distance_miles);
      setNoTimePref(data.notify_nearby_opportunities_time_pref ?? 'anytime');
      setNoCategories(data.notify_nearby_opportunities_categories ?? null);
      setDiscoveryViewStyle(data.discovery_view_style ?? 'list');
      setReadReceiptsEnabled(data.read_receipts_enabled ?? true);
      setShareInterestInDemand(data.share_interest_in_demand ?? true);
      setShowSponsoredPlaces(data.show_sponsored_places ?? true);
      setWomenMessageFirst(data.women_message_first ?? false);
      setIntentVisibility(data.intent_visibility ?? 'friends_and_matches');
    }
  }

  async function updateDiscoveryViewStyle(style) {
    setDiscoveryViewStyle(style);
    const { error } = await supabase.from('profiles').update({ discovery_view_style: style }).eq('id', userId);
    if (error) {
      presentRecoverableError(Alert, { what: 'complete that', error: error, onRetry: () => updateDiscoveryViewStyle(style) });
    }
  }

  // 10/10 roadmap Part 6: a plain two-option picker, no new taxonomy --
  // narrows an already-friends/matches-only surface
  // (get_connected_open_business_requests, Tier 2 of the intent resolver)
  // further, never widens the locked no-stranger-discovery boundary.
  async function updateIntentVisibility(value) {
    const previous = intentVisibility;
    setIntentVisibility(value);
    const { error } = await supabase.from('profiles').update({ intent_visibility: value }).eq('id', userId);
    if (error) {
      setIntentVisibility(previous);
      presentRecoverableError(Alert, { what: 'complete that', error: error, onRetry: () => updateIntentVisibility(value) });
    }
  }

  async function toggleNotificationGroup(group, enabled) {
    const previous = notificationMutes;
    setNotificationMutes(toggleGroup(previous, group, enabled));
    try {
      setNotificationMutes(await setMyNotificationGroup(group, enabled));
      // No recommendations = no reason to keep the coarse notification area (same as before).
      if (group === 'discover_recommendations' && !enabled) clearNotificationArea().catch(() => {});
    } catch (e) {
      setNotificationMutes(previous);
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => toggleNotificationGroup(group, enabled) });
    }
  }

  async function saveRecPref(column, value, setter) {
    setter(value);
    const { error } = await supabase.from('profiles').update({ [column]: value }).eq('id', userId);
    if (error) {
      presentRecoverableError(Alert, { what: 'complete that', error: error, onRetry: () => saveRecPref(column, value, setter) });
    }
  }

  function toggleRecCategory(tag, selectedCategories, column, setter) {
    const current = selectedCategories ?? myInterests;
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    const finalValue = next.length === myInterests.length ? null : next;
    saveRecPref(column, finalValue, setter);
  }

  async function sendPhoneChangeOtp() {
    const formatted = toE164(newPhoneInput);
    if (!formatted) {
      return Alert.alert(t('ui.settings.invalidNumber'), t('ui.settings.enterA10DigitUs'));
    }
    const { error } = await supabase.auth.updateUser({ phone: formatted });
    if (error) return presentRecoverableError(Alert, { what: 'complete that', error: error, onRetry: () => sendPhoneChangeOtp() });
    setE164NewPhone(formatted);
    setOtpSent(true);
  }

  async function verifyPhoneChange() {
    const { error } = await supabase.auth.verifyOtp({
      phone: e164NewPhone,
      token: otp,
      type: 'phone_change',
    });
    if (error) return presentRecoverableError(Alert, { what: 'complete that', error: error, onRetry: () => verifyPhoneChange() });
    showSuccessToast(t('ui.settings.phoneNumberUpdated'), t('ui.settings.yourNewNumberIsNow'));
    setChangingPhone(false);
    setOtpSent(false);
    setNewPhoneInput('');
    setOtp('');
  }

  async function handleDataExport() {
    setExporting(true);
    try {
      await requestDataExport();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleDataExport() });
    }
    setExporting(false);
  }

  async function signOut() {
    // supabase.auth.signOut() invalidates the session server-side before
    // resolving -- a real network round trip, not a local-only clear -- so
    // with no visible state change while it's in flight, a moderately slow
    // network reads as the button just hanging. This gives real, immediate
    // feedback instead; the actual sign-out mechanism is unchanged.
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
    } finally {
      setSigningOut(false);
    }
  }

  function confirmDeleteAccount() {
    Alert.alert(
      t('ui.settings.deleteYourAccount'),
      t('ui.settings.thisPermanentlyDeletesYourProfile'),
      [
        { text: t('ui.settings.cancel'), style: 'cancel' },
        { text: t('ui.settings.continue'), style: 'destructive', onPress: confirmDeleteAccountFinal },
      ]
    );
  }

  function confirmDeleteAccountFinal() {
    Alert.alert(
      t('ui.settings.areYouAbsolutelySure'),
      t('ui.settings.yourAccountAndAllAssociated'),
      [
        { text: t('ui.settings.cancel'), style: 'cancel' },
        { text: t('ui.settings.deleteMyAccount'), style: 'destructive', onPress: handleDeleteAccount },
      ]
    );
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (e) {
      setDeleting(false);
      Alert.alert(t('ui.settings.deletionFailed'), e.message);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.header} accessibilityRole="header">{t('settings.title')}</Text>

        {osNotifPermission !== 'granted' && (
          <TouchableOpacity
            style={styles.permissionBanner}
            onPress={openSystemSettings}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.settings.notificationsAreTurnedOffInA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.permissionBannerIcon}>🔕</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.permissionBannerTitle}>{t('ui.settings.notificationsAreOff')}</Text>
              <Text style={styles.permissionBannerText}>
                {t('ui.settings.youWontGetAlertsFor')}
              </Text>
            </View>
            <Text style={styles.permissionBannerArrow}>›</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.groupHeader} accessibilityRole="header">{t('ui.settings.account')}</Text>
        <View style={styles.card}>
          {!changingPhone ? (
            <TouchableOpacity
              style={styles.rowButton}
              onPress={() => setChangingPhone(true)}
              accessibilityLabel={t('settings.changePhoneNumber')}
              accessibilityRole="button"
            >
              <Text style={styles.rowButtonText}>{t('settings.changePhoneNumber')}</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ) : !otpSent ? (
            <View>
              <Text style={styles.label}>{t('ui.settings.newPhoneNumber')}</Text>
              <TextInput
                style={styles.input}
                placeholder="(555) 555-5555"
                placeholderTextColor={colors.textTertiary}
                keyboardType="phone-pad"
                value={newPhoneInput}
                onChangeText={setNewPhoneInput}
                accessibilityLabel={t('ui.settings.newPhoneNumberA11y')}
              />
              <TouchableOpacity
                style={styles.button}
                onPress={sendPhoneChangeOtp}
                activeOpacity={0.85}
                accessibilityLabel={t('ui.settings.sendVerificationCodeA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>{t('ui.settings.sendVerificationCode')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setChangingPhone(false)}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel={t('ui.settings.cancelA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.cancelText}>{t('ui.settings.cancel')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.label}>{t('ui.settings.enterTheCodeSentTo', { newPhoneInput: newPhoneInput })}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('ui.settings.n6DigitCode')}
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                value={otp}
                onChangeText={setOtp}
                accessibilityLabel={t('ui.settings.verificationCodeA11y')}
              />
              <TouchableOpacity
                style={styles.button}
                onPress={verifyPhoneChange}
                activeOpacity={0.85}
                accessibilityLabel={t('ui.settings.confirmNewNumberA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>{t('ui.settings.confirmNewNumber')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('Billing')}
          activeOpacity={0.85}
          accessibilityLabel={t('settings.manageSubscription')}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>💳 {t('settings.manageSubscription')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleDataExport}
          disabled={exporting}
          accessibilityLabel={exporting ? t('ui.settings.preparingExportA11y') : t('ui.settings.requestMyDataA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.signOutText}>{exporting ? t('ui.settings.preparingExport') : t('ui.settings.requestMyData')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.deleteButton}
          onPress={confirmDeleteAccount}
          disabled={deleting}
          accessibilityLabel={deleting ? t('ui.settings.deletingAccountA11y') : t('ui.settings.deleteAccountThisPermanentlyRemovesA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.deleteText}>
            {deleting ? t('ui.settings.deletingAccount') : t('ui.settings.deleteAccount')}
          </Text>
        </TouchableOpacity>

        <Text
          style={styles.groupHeader}
          accessibilityRole="header"
          onLayout={(e) => { preferencesYRef.current = e.nativeEvent.layout.y; }}
        >
          {t('ui.settings.preferences')}
        </Text>

        {/* Aug 30 2026 (CLAUDE.md, external product-critique reply): "Dating
            preferences are product preferences, not application settings."
            What's looking for/age range/ethnicity preferences used to be
            edited inline right here now lives at its real canonical home,
            DatingPreferencesScreen -- reached from Discover -> People ->
            Dating (a real dedicated icon there) as well as from this one
            shortcut row. Settings is no longer where these are actually
            written; it's just a pointer, matching the same "don't delete
            legacy data, just stop asking" posture the taxonomy pass already
            established for discovery_gender/show_me above. */}
        <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.settings.datingPreferences')}</Text>
        <TouchableOpacity
          style={[styles.card, styles.settingRow]}
          onPress={() => navigation.navigate('DatingPreferences')}
          activeOpacity={0.85}
          accessibilityLabel={t('ui.settings.datingPreferencesManageInYourA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.settingLabel}>{t('ui.settings.datingPreferences2')}</Text>
          <Text style={styles.linkText}>{t('ui.settings.manage')}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('settings.appearance')}</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('settings.darkMode')}</Text>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel={t('ui.settings.darkModeA11y')}
            />
          </View>
          <View style={styles.divider} />
          <View style={{ paddingVertical: spacing.sm }}>
            <Text style={styles.settingLabel}>{t('ui.settings.nearbyDisplayStyle')}</Text>
            <Text style={styles.helperText}>{t('ui.settings.chooseHowProfilesAreShown')}</Text>
            <View style={[styles.chipsWrap, { marginTop: spacing.sm }]}>
              <TouchableOpacity
                style={[styles.chip, discoveryViewStyle === 'list' && styles.chipSelected]}
                onPress={() => updateDiscoveryViewStyle('list')}
                activeOpacity={0.85}
                accessibilityLabel={t('ui.settings.listViewA11y')}
                accessibilityRole="button"
                accessibilityState={{ selected: discoveryViewStyle === 'list' }}
              >
                <Text style={[styles.chipText, discoveryViewStyle === 'list' && styles.chipTextSelected]}>{t('ui.settings.list')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, discoveryViewStyle === 'cards' && styles.chipSelected]}
                onPress={() => updateDiscoveryViewStyle('cards')}
                activeOpacity={0.85}
                accessibilityLabel={t('ui.settings.cardSwipeViewA11y')}
                accessibilityRole="button"
                accessibilityState={{ selected: discoveryViewStyle === 'cards' }}
              >
                <Text style={[styles.chipText, discoveryViewStyle === 'cards' && styles.chipTextSelected]}>{t('ui.settings.cards')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('settings.language')}</Text>
        <View style={styles.card}>
          <View style={styles.chipsWrap}>
            <TouchableOpacity
              style={[styles.chip, language === 'en' && styles.chipSelected]}
              onPress={() => setLanguage('en')}
              activeOpacity={0.85}
              accessibilityLabel="English"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'en' }}
            >
              <Text style={[styles.chipText, language === 'en' && styles.chipTextSelected]}>English</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'es' && styles.chipSelected]}
              onPress={() => setLanguage('es')}
              activeOpacity={0.85}
              accessibilityLabel="Español"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'es' }}
            >
              <Text style={[styles.chipText, language === 'es' && styles.chipTextSelected]}>Español</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'de' && styles.chipSelected]}
              onPress={() => setLanguage('de')}
              activeOpacity={0.85}
              accessibilityLabel="Deutsch"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'de' }}
            >
              <Text style={[styles.chipText, language === 'de' && styles.chipTextSelected]}>Deutsch</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'fr' && styles.chipSelected]}
              onPress={() => setLanguage('fr')}
              activeOpacity={0.85}
              accessibilityLabel="Français"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'fr' }}
            >
              <Text style={[styles.chipText, language === 'fr' && styles.chipTextSelected]}>Français</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'pt' && styles.chipSelected]}
              onPress={() => setLanguage('pt')}
              activeOpacity={0.85}
              accessibilityLabel="Português"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'pt' }}
            >
              <Text style={[styles.chipText, language === 'pt' && styles.chipTextSelected]}>Português</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'ht' && styles.chipSelected]}
              onPress={() => setLanguage('ht')}
              activeOpacity={0.85}
              accessibilityLabel="Kreyòl Ayisyen"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'ht' }}
            >
              <Text style={[styles.chipText, language === 'ht' && styles.chipTextSelected]}>Kreyòl Ayisyen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'zh' && styles.chipSelected]}
              onPress={() => setLanguage('zh')}
              activeOpacity={0.85}
              accessibilityLabel="中文"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'zh' }}
            >
              <Text style={[styles.chipText, language === 'zh' && styles.chipTextSelected]}>中文</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'vi' && styles.chipSelected]}
              onPress={() => setLanguage('vi')}
              activeOpacity={0.85}
              accessibilityLabel="Tiếng Việt"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'vi' }}
            >
              <Text style={[styles.chipText, language === 'vi' && styles.chipTextSelected]}>Tiếng Việt</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'tl' && styles.chipSelected]}
              onPress={() => setLanguage('tl')}
              activeOpacity={0.85}
              accessibilityLabel="Tagalog"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'tl' }}
            >
              <Text style={[styles.chipText, language === 'tl' && styles.chipTextSelected]}>Tagalog</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'ru' && styles.chipSelected]}
              onPress={() => setLanguage('ru')}
              activeOpacity={0.85}
              accessibilityLabel="Русский"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'ru' }}
            >
              <Text style={[styles.chipText, language === 'ru' && styles.chipTextSelected]}>Русский</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'ko' && styles.chipSelected]}
              onPress={() => setLanguage('ko')}
              activeOpacity={0.85}
              accessibilityLabel="한국어"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'ko' }}
            >
              <Text style={[styles.chipText, language === 'ko' && styles.chipTextSelected]}>한국어</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.groupHeader} accessibilityRole="header">{t('settings.notifications')}</Text>
        <View style={styles.card}>
          {visibleSettingsSections({ isBusinessOwner }).map((area, ai) => (
            <View key={area.key}>
              {ai > 0 && <View style={styles.divider} />}
              <Text style={styles.settingLabel} accessibilityRole="header">{area.icon} {t(`ui.notificationPrefs.section.${area.key}.label`)}</Text>
              <Text style={styles.helperText}>{t(`ui.notificationPrefs.section.${area.key}.hint`)}</Text>
              {area.groups.map((g) => {
                const on = !notificationMutes.includes(g);
                const keys = groupTextKeys(g);
                const label = t(keys.label);
                return (
                  <View key={g}>
                    <View style={styles.settingRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.helperText}><Text style={{ fontWeight: '600' }}>{label}</Text>{'\n'}{t(keys.hint)}</Text>
                      </View>
                      <Switch
                        value={on}
                        onValueChange={(v) => toggleNotificationGroup(g, v)}
                        trackColor={{ true: colors.primary, false: colors.border }}
                        accessibilityLabel={t('ui.notificationPrefs.toggleA11y', { label })}
                      />
                    </View>
                    {g === 'discover_recommendations' && on && (
                      <>
                    <TouchableOpacity
                      style={styles.customizeLink}
                      onPress={() => clearNotificationArea()
                        .then(() => showSuccessToast(t('ui.settings.savedAreaCleared'), t('ui.settings.nearbyWillSaveAFresh')))
                        .catch((e) => presentRecoverableError(Alert, { what: 'complete that', error: e }))}
                      accessibilityLabel={t('ui.settings.clearMySavedAreaA11y')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.customizeLinkText}>{t('ui.settings.clearMySavedAreaRefreshes')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.customizeLink}
                      onPress={() => setExpandedRecPanel(expandedRecPanel === 'things_to_do' ? null : 'things_to_do')}
                      accessibilityLabel={t('ui.settings.customizeThingsToDoNotificationsA11y')}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: expandedRecPanel === 'things_to_do' }}
                    >
                      <Text style={styles.customizeLinkText}>
                        {expandedRecPanel === 'things_to_do' ? t('ui.settings.hideThingsToDoFrequency') : t('ui.settings.thingsToDoFrequencyCategories')}
                      </Text>
                    </TouchableOpacity>
                    {expandedRecPanel === 'things_to_do' && (
                      <RecommendationCustomizePanel
                        colors={colors}
                        myInterests={myInterests}
                        frequency={ttdFrequency}
                        distance={ttdDistance}
                        timePref={ttdTimePref}
                        selectedCategories={ttdCategories}
                        onChangeFrequency={(v) => saveRecPref('notify_things_to_do_frequency', v, setTtdFrequency)}
                        onChangeDistance={(v) => saveRecPref('notify_things_to_do_max_distance_miles', v, setTtdDistance)}
                        onChangeTimePref={(v) => saveRecPref('notify_things_to_do_time_pref', v, setTtdTimePref)}
                        onToggleCategory={(tag) => toggleRecCategory(tag, ttdCategories, 'notify_things_to_do_categories', setTtdCategories)}
                        onPressAddInterests={() => navigateKeepingTrail(navigation, 'Profile', { scrollToInterestsSection: Date.now() })}
                      />
                    )}
                    <TouchableOpacity
                      style={styles.customizeLink}
                      onPress={() => setExpandedRecPanel(expandedRecPanel === 'nearby_opportunities' ? null : 'nearby_opportunities')}
                      accessibilityLabel={t('ui.settings.customizeNearbyOpportunitiesNotificationsA11y')}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: expandedRecPanel === 'nearby_opportunities' }}
                    >
                      <Text style={styles.customizeLinkText}>
                        {expandedRecPanel === 'nearby_opportunities' ? t('ui.settings.hideNearbyOpportunitiesFrequencyCategories') : t('ui.settings.nearbyOpportunitiesFrequencyCategoriesDistance')}
                      </Text>
                    </TouchableOpacity>
                    {expandedRecPanel === 'nearby_opportunities' && (
                      <RecommendationCustomizePanel
                        colors={colors}
                        myInterests={myInterests}
                        frequency={noFrequency}
                        distance={noDistance}
                        timePref={noTimePref}
                        selectedCategories={noCategories}
                        onChangeFrequency={(v) => saveRecPref('notify_nearby_opportunities_frequency', v, setNoFrequency)}
                        onChangeDistance={(v) => saveRecPref('notify_nearby_opportunities_max_distance_miles', v, setNoDistance)}
                        onChangeTimePref={(v) => saveRecPref('notify_nearby_opportunities_time_pref', v, setNoTimePref)}
                        onToggleCategory={(tag) => toggleRecCategory(tag, noCategories, 'notify_nearby_opportunities_categories', setNoCategories)}
                        onPressAddInterests={() => navigateKeepingTrail(navigation, 'Profile', { scrollToInterestsSection: Date.now() })}
                      />
                    )}
                      </>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.settings.whatYoureHereToDo')}</Text>
        <View style={styles.card}>
          <Text style={styles.helperText}>{t('ui.settings.shapesTheShortcutsOnYour')}</Text>
          {ONBOARDING_GOALS.map((g) => {
            const selected = motivations.includes(g.label);
            return (
              <TouchableOpacity
                key={g.key}
                style={styles.settingRow}
                onPress={() => toggleGoal(g.label)}
                accessibilityLabel={t(`ui.onboarding.goal.${g.key}`)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
              >
                <Text style={styles.settingLabel}>{g.icon}  {t(`ui.onboarding.goal.${g.key}`)}</Text>
                <Text style={styles.settingLabel}>{selected ? '☑' : '☐'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.settings.broadInterests')}</Text>
        <View style={styles.card}>
          <Text style={styles.helperText}>{t('ui.settings.categoriesYouLikeInGeneral')}</Text>
          {ONBOARDING_INTEREST_GROUPS.map((g) => {
            const selected = interestGroups.includes(g.key);
            return (
              <TouchableOpacity
                key={g.key}
                style={styles.settingRow}
                onPress={() => toggleInterestGroup(g.key)}
                accessibilityLabel={groupName(g.key, language)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
              >
                <Text style={styles.settingLabel}>{g.icon ? `${g.icon}  ` : ''}{groupName(g.key, language)}</Text>
                <Text style={styles.settingLabel}>{selected ? '☑' : '☐'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.groupHeader} accessibilityRole="header">{t('ui.settings.privacySafety')}</Text>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.settings.privacy')}</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t('ui.settings.activityThatShapesYourPicks')}</Text>
              <Text style={styles.helperText}>{t('ui.settings.nearbyNoticesWhichKindsOf')}</Text>
              {learned.length > 0 && (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={styles.settingLabel}>{t('ui.settings.whatNearbyHasNoticed')}</Text>
                  {learned.map((a) => (
                    <View key={a.category} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, gap: spacing.sm }}>
                      <Text style={[styles.helperText, { flex: 1 }]}>{a.category}{a.inProfile ? t('ui.settings.alreadyInYourInterests') : ''}</Text>
                      {!a.inProfile && (
                        <TouchableOpacity
                          onPress={() => addLearnedInterestToProfile(a.category)
                            .then((next) => {
                            setMyInterests(next);
                            // Item 124: Undo takes back only this tag, and only if the tap really added it.
                            const added = !(myInterests ?? []).includes(a.category);
                            showSuccessToast(t('ui.settings.addedToYourInterests'), t('ui.settings.isNowOnYourProfile', { category: a.category }), added ? {
                              undo: () => removeAddedInterestFromProfile(a.category)
                                .then(setMyInterests)
                                .catch((e) => presentRecoverableError(Alert, { what: 'undo that', error: e })),
                            } : undefined);
                          })
                            .catch((e) => presentRecoverableError(Alert, { what: 'add that interest', error: e }))}
                          accessibilityLabel={t('ui.settings.addToMyInterestsA11y', { category: a.category })}
                          accessibilityRole="button"
                        >
                          <Text style={styles.customizeLinkText}>{t('ui.settings.addToMyInterests')}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={() => forgetBehaviorCategory(a.category)
                          .then(() => { loadLearned(); showSuccessToast(t('ui.settings.forgotten'), t('ui.settings.nearbyWillStopUsingYour', { category: a.category })); })
                          .catch((e) => presentRecoverableError(Alert, { what: 'forget that', error: e }))}
                        accessibilityLabel={t('ui.settings.forgetMyActivityA11y', { category: a.category })}
                        accessibilityRole="button"
                      >
                        <Text style={styles.customizeLinkText}>{t('ui.settings.forget')}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              {/* Item 137: how far this person usually goes per category, learned from their own joins / accepted offers.
                  Visible so it is never a hidden rule; Forget removes the category's activity (trips included). */}
              {usualTrips.length > 0 && (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={styles.settingLabel}>{t('ui.settings.usualTripTitle')}</Text>
                  <Text style={styles.helperText}>{t('ui.settings.usualTripHelper')}</Text>
                  {usualTrips.map((u) => (
                    <View key={u.category} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, gap: spacing.sm }}>
                      <Text style={[styles.helperText, { flex: 1 }]}>{t('ui.settings.usualTripLine', { category: categoryName(u.category, language), distance: localDistance(u.typicalMiles, language), count: u.count })}</Text>
                      <TouchableOpacity
                        onPress={() => forgetBehaviorCategory(u.category)
                          .then(() => { loadLearned(); showSuccessToast(t('ui.settings.forgotten'), t('ui.settings.nearbyWillStopUsingYour', { category: u.category })); })
                          .catch((e) => presentRecoverableError(Alert, { what: 'forget that', error: e }))}
                        accessibilityLabel={t('ui.settings.forgetMyActivityA11y', { category: u.category })}
                        accessibilityRole="button"
                      >
                        <Text style={styles.customizeLinkText}>{t('ui.settings.forget')}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              <TouchableOpacity
                style={styles.customizeLink}
                onPress={() => clearMyBehaviorHistory()
                  .then(() => { setBehaviorRows([]); setUsualTrips([]); resetLearnedProximityCache(); return showSuccessToast(t('ui.settings.activityCleared'), t('ui.settings.yourPicksWillRelyOn')); })
                  .catch((e) => presentRecoverableError(Alert, { what: 'complete that', error: e }))}
                accessibilityLabel={t('ui.settings.clearMyActivityHistoryA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.customizeLinkText}>{t('ui.settings.clearMyActivityHistory')}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t('ui.settings.includeMyInterestedInAnonymous')}</Text>
              <Text style={styles.helperText}>{t('ui.settings.whenYouTapInterestedOn')}</Text>
            </View>
            <Switch
              value={shareInterestInDemand}
              onValueChange={(v) => toggleNotifPref('share_interest_in_demand', v, setShareInterestInDemand)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel={t('ui.settings.includeMyInterestedActivityInA11y')}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t('ui.settings.showSponsoredPlaces')}</Text>
              <Text style={styles.helperText}>{t('ui.settings.businessesCanPayToBe')}</Text>
              <TouchableOpacity
                onPress={async () => {
                  const ok = await clearHiddenSponsors();
                  Alert.alert(ok ? t('ui.settings.done') : t('ui.settings.error'), ok ? t('ui.settings.sponsorsYouHidCanAppear') : t('ui.settings.couldNotResetPleaseTry'));
                }}
                accessibilityRole="button"
                accessibilityLabel={t('ui.settings.resetHiddenSponsorsA11y')}
              >
                <Text style={[styles.helperText, { textDecorationLine: 'underline' }]}>{t('ui.settings.resetHiddenSponsors')}</Text>
              </TouchableOpacity>
            </View>
            <Switch
              value={showSponsoredPlaces}
              onValueChange={(v) => toggleNotifPref('show_sponsored_places', v, setShowSponsoredPlaces)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel={t('ui.settings.showSponsoredPlacesA11y')}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t('ui.settings.readReceipts')}</Text>
              <Text style={styles.helperText}>{t('ui.settings.letMatchesSeeWhenYouve')}</Text>
            </View>
            <Switch
              value={readReceiptsEnabled}
              onValueChange={(v) => toggleNotifPref('read_receipts_enabled', v, setReadReceiptsEnabled)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel={t('ui.settings.readReceiptsA11y')}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t('ui.settings.iMessageFirst')}</Text>
              <Text style={styles.helperText}>{t('ui.settings.whenYouMatchWithSomeone')}</Text>
            </View>
            <Switch
              value={womenMessageFirst}
              onValueChange={(v) => toggleNotifPref('women_message_first', v, setWomenMessageFirst)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel={t('ui.settings.iMessageFirstA11y')}
            />
          </View>
          <View style={styles.divider} />
          <View>
            <Text style={styles.settingLabel}>{t('ui.settings.whoCanSeeMyRequests')}</Text>
            <Text style={styles.helperText}>
              {t('ui.settings.aCoffeeTonightRequestYou')}
            </Text>
            <View style={[styles.chipsWrap, { marginTop: spacing.sm }]}>
              <TouchableOpacity
                style={[styles.chip, intentVisibility === 'friends_and_matches' && styles.chipSelected]}
                onPress={() => updateIntentVisibility('friends_and_matches')}
                accessibilityRole="button"
                accessibilityLabel={t('ui.settings.friendsMatchesA11y')}
              >
                <Text style={[styles.chipText, intentVisibility === 'friends_and_matches' && styles.chipTextSelected]}>{t('ui.settings.friendsMatches')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, intentVisibility === 'nobody' && styles.chipSelected]}
                onPress={() => updateIntentVisibility('nobody')}
                accessibilityRole="button"
                accessibilityLabel={t('ui.settings.nobodyA11y')}
              >
                <Text style={[styles.chipText, intentVisibility === 'nobody' && styles.chipTextSelected]}>{t('ui.settings.nobody')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.settings.safety')}</Text>
        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('BlockedUsers')}
          activeOpacity={0.85}
          accessibilityLabel={t('ui.settings.blockedUsersA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>{t('ui.settings.blockedUsers')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('IdVerification')}
          activeOpacity={0.85}
          accessibilityLabel={t('ui.settings.verifyYourIdentityA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>{t('ui.settings.verifyIdentity')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('EmergencyContacts')}
          activeOpacity={0.85}
          accessibilityLabel={t('ui.settings.emergencyContactsA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>{t('ui.settings.emergencyContacts')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        {isAdmin && (
          <TouchableOpacity
            style={styles.rowButtonCard}
            onPress={() => navigation.navigate('AdminReports')}
            activeOpacity={0.85}
            accessibilityLabel="Review reports, admin"
            accessibilityRole="button"
          >
            <Text style={styles.rowButtonText}>Review Reports (Admin)</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}

        {isAdmin && (
          <>
            <Text style={styles.groupHeader} accessibilityRole="header">Business (Admin)</Text>
            <TouchableOpacity
              style={styles.rowButtonCard}
              onPress={() => navigation.navigate('BusinessDashboard')}
              activeOpacity={0.85}
              accessibilityLabel="Business dashboard, admin"
              accessibilityRole="button"
            >
              <Text style={styles.rowButtonText}>Business Dashboard (Admin)</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.rowButtonCard}
              onPress={() => navigation.navigate('AdminBusinessRequests')}
              activeOpacity={0.85}
              accessibilityLabel="Review business partner requests, admin"
              accessibilityRole="button"
            >
              <Text style={styles.rowButtonText}>Business Requests (Admin)</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.rowButtonCard}
              onPress={() => navigation.navigate('AdminSponsoredRefunds')}
              activeOpacity={0.85}
              accessibilityLabel="Sponsored refunds, admin"
              accessibilityRole="button"
            >
              <Text style={styles.rowButtonText}>Sponsored Refunds (Admin)</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.rowButtonCard}
              onPress={() => navigation.navigate('AdminVerification')}
              activeOpacity={0.85}
              accessibilityLabel="Review pending verifications, admin"
              accessibilityRole="button"
            >
              <Text style={styles.rowButtonText}>Review Verifications (Admin)</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.rowButtonCard}
              onPress={() => navigation.navigate('MarketValidation')}
              activeOpacity={0.85}
              accessibilityLabel="Market validation dashboard, admin"
              accessibilityRole="button"
            >
              <Text style={styles.rowButtonText}>Market Validation (Admin)</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            {/* Business Intelligence Phase 8: dev/admin-only tier switch --
                real plan-entitlement changes, no billing, never shown to a
                real business anywhere else in the app. */}
            <TouchableOpacity
              style={styles.rowButtonCard}
              onPress={() => navigation.navigate('AdminBusinessTier')}
              activeOpacity={0.85}
              accessibilityLabel="Business tier switch, admin, development tooling"
              accessibilityRole="button"
            >
              <Text style={styles.rowButtonText}>Business Tier Switch (Admin, Dev)</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            {/* Decision 6, Phase 1 (CLAUDE.md's Aug 27 2026 plan) -- the
                real Content Review Queue: every business_profile edit still
                genuinely awaiting a human decision (medium/uncertain risk
                tier). A HIGH result is auto-blocked and never reaches this
                queue; a LOW result publishes immediately and never needs one. */}
            <TouchableOpacity
              style={styles.rowButtonCard}
              onPress={() => navigation.navigate('AdminContentReview')}
              activeOpacity={0.85}
              accessibilityLabel="Content review queue, admin"
              accessibilityRole="button"
            >
              <Text style={styles.rowButtonText}>Content Review Queue (Admin)</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={styles.groupHeader} accessibilityRole="header">{t('ui.settings.connect')}</Text>
        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('Friends')}
          activeOpacity={0.85}
          accessibilityLabel={t('ui.settings.friendsManageFriendRequestsAndA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>{t('ui.settings.friends')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('MusicMode')}
          activeOpacity={0.85}
          accessibilityLabel={t('ui.settings.musicModeConnectSpotifyAndA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>{t('ui.settings.musicMode')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('InviteFriends')}
          activeOpacity={0.85}
          accessibilityLabel={t('ui.settings.inviteFriendsA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>{t('ui.settings.inviteFriends')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigateKeepingTrail(navigation, 'Discover', { ...PERKS_TAB })}
          activeOpacity={0.85}
          accessibilityLabel={t('ui.settings.offersAndPerksA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>{t('ui.settings.offersPerks')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        {/* Rule 14: the relationship tools are a section here, not a menu screen of their own. Memory Vaults open from each
            match's own chat ("Do something together"), as do the other match-specific tools. */}
        <Text style={styles.groupHeader} accessibilityRole="header">{t('ui.settings.relationship')}</Text>
        {RELATIONSHIP_SECTIONS.map((section) => (
          <View key={section.key}>
            <Text style={styles.relSectionSubtitle}>{t(`ui.relationship.hub.${section.key}.subtitle`)}</Text>
            {section.whereKey && (
              <Text style={styles.relSectionSubtitle}>{t(section.whereKey, { menu: t('ui.chat.doSomethingTogether') })}</Text>
            )}
            {section.rows.map((row) => (
              <TouchableOpacity
                key={row.key}
                style={styles.rowButtonCard}
                onPress={() => navigation.navigate(row.route)}
                activeOpacity={0.85}
                accessibilityLabel={t(`ui.relationship.hub.row.${row.key}.a11y`)}
                accessibilityRole="button"
              >
                <Text style={styles.rowButtonText}>{row.icon} {t(`ui.relationship.hub.row.${row.key}.label`)}</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}

        <Text style={styles.groupHeader} accessibilityRole="header">{t('ui.settings.support')}</Text>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('Legal')}
          activeOpacity={0.85}
          accessibilityLabel={t('settings.legal')}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>{t('settings.legal')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signOutButton}
          onPress={signOut}
          disabled={signingOut}
          accessibilityLabel={t('ui.settings.signOutA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.signOutText}>{signingOut ? t('ui.settings.signingOut') : t('ui.settings.signOut')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.lg },
  permissionBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.primary,
  },
  permissionBannerIcon: { fontSize: 22, marginRight: spacing.sm },
  permissionBannerTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14, marginBottom: 2 },
  permissionBannerText: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  permissionBannerArrow: { color: colors.textTertiary, fontSize: 20, marginLeft: spacing.xs },
  groupHeader: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: spacing.lg },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  settingLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  customizeLink: { paddingBottom: spacing.sm },
  customizeLinkText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  divider: { height: 1, backgroundColor: colors.border },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.sm, padding: spacing.md, fontSize: 15 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  helperText: { ...typography.small, color: colors.textTertiary, marginTop: spacing.sm, lineHeight: 16 },
  linkText: { ...typography.body, color: colors.primary, fontWeight: '600' },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg, ...shadow.button },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelText: { color: colors.textTertiary, textAlign: 'center', fontSize: 13 },
  rowButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  relSectionSubtitle: { color: colors.textTertiary, fontSize: 12, marginBottom: spacing.sm, lineHeight: 16 },
  rowButtonCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  rowButtonText: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  chevron: { color: colors.textTertiary, fontSize: 20, fontWeight: '700' },
  signOutButton: { paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  signOutText: { color: colors.textTertiary, fontSize: 14 },
  deleteButton: { paddingVertical: spacing.sm, alignItems: 'center' },
  deleteText: { color: colors.danger, fontSize: 13, opacity: 0.7 },
});

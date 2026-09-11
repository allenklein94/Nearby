import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, ScrollView, Switch, Linking, Platform, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { deleteAccount } from '../services/account';
import { requestDataExport } from '../services/dataExport';
import RecommendationCustomizePanel from '../components/RecommendationCustomizePanel';
import { typography, spacing, radius } from '../theme';

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
export default function SettingsScreen({ navigation, route }) {
  const { isAdmin } = useAuth();
  const { colors, shadow, isDark, toggleTheme } = useTheme();
  const { t, language, setLanguage } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [userId, setUserId] = useState(null);
  const [discoveryViewStyle, setDiscoveryViewStyle] = useState('list');
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(true);
  const [womenMessageFirst, setWomenMessageFirst] = useState(false);
  const [intentVisibility, setIntentVisibility] = useState('friends_and_matches');

  // External UX critique item 29 (2026-09-11): "notifications should be an
  // intelligent layer, not a firehose" -- the growing pile of individual
  // per-feature toggles (notify_friends/dating/messages/waves/plans/
  // things_to_do/nearby_opportunities/crossed_paths/businesses_offers,
  // several generations of one-off additions) is replaced with 6 named
  // categories the user actually chose: Social, Discovery, Proximity,
  // Planning, Business, Community. Every push-sending function in the
  // database was individually re-gated onto these 6 columns (including a
  // dozen real, previously *ungated* business-side pushes found during
  // this audit) -- see the migration's own header comment for the full
  // per-function mapping. Discovery is the one category with real
  // sub-preferences underneath it (frequency/distance/time/categories,
  // still separately tracked per the Things To Do / Nearby Opportunities
  // domains from item 17) -- those are unchanged, only their plain on/off
  // master switch collapsed into notify_discovery below.
  const [notifySocial, setNotifySocial] = useState(true);
  const [notifyDiscovery, setNotifyDiscovery] = useState(true);
  const [notifyProximity, setNotifyProximity] = useState(true);
  const [notifyPlanning, setNotifyPlanning] = useState(true);
  const [notifyBusiness, setNotifyBusiness] = useState(true);
  const [notifyCommunity, setNotifyCommunity] = useState(true);
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

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    const id = sessionData?.session?.user?.id;
    setUserId(id);

    const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
    if (data) {
      setNotifySocial(data.notify_social ?? true);
      setNotifyDiscovery(data.notify_discovery ?? true);
      setNotifyProximity(data.notify_proximity ?? true);
      setNotifyPlanning(data.notify_planning ?? true);
      setNotifyBusiness(data.notify_business ?? true);
      setNotifyCommunity(data.notify_community ?? true);
      setMyInterests(data.interests ?? []);
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
      setWomenMessageFirst(data.women_message_first ?? false);
      setIntentVisibility(data.intent_visibility ?? 'friends_and_matches');
    }
  }

  async function updateDiscoveryViewStyle(style) {
    setDiscoveryViewStyle(style);
    const { error } = await supabase.from('profiles').update({ discovery_view_style: style }).eq('id', userId);
    if (error) {
      Alert.alert('Error', error.message);
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
      Alert.alert('Error', error.message);
    }
  }

  async function toggleNotifPref(key, value, setter) {
    setter(value);
    const { error } = await supabase.from('profiles').update({ [key]: value }).eq('id', userId);
    if (error) {
      setter(!value);
      Alert.alert('Error', error.message);
    }
  }

  async function saveRecPref(column, value, setter) {
    setter(value);
    const { error } = await supabase.from('profiles').update({ [column]: value }).eq('id', userId);
    if (error) {
      Alert.alert('Error', error.message);
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
      return Alert.alert('Invalid number', 'Enter a 10-digit US phone number.');
    }
    const { error } = await supabase.auth.updateUser({ phone: formatted });
    if (error) return Alert.alert('Error', error.message);
    setE164NewPhone(formatted);
    setOtpSent(true);
  }

  async function verifyPhoneChange() {
    const { error } = await supabase.auth.verifyOtp({
      phone: e164NewPhone,
      token: otp,
      type: 'phone_change',
    });
    if (error) return Alert.alert('Error', error.message);
    Alert.alert('Phone number updated', 'Your new number is now linked to your account.');
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
      Alert.alert('Export failed', e.message);
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
      'Delete your account?',
      'This permanently deletes your profile, photo, matches, and messages. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: confirmDeleteAccountFinal },
      ]
    );
  }

  function confirmDeleteAccountFinal() {
    Alert.alert(
      'Are you absolutely sure?',
      'Your account and all associated data will be permanently deleted right now.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete My Account', style: 'destructive', onPress: handleDeleteAccount },
      ]
    );
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (e) {
      setDeleting(false);
      Alert.alert('Deletion failed', e.message);
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
            accessibilityLabel="Notifications are turned off in your device settings, tap to enable"
            accessibilityRole="button"
          >
            <Text style={styles.permissionBannerIcon}>🔕</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.permissionBannerTitle}>Notifications are off</Text>
              <Text style={styles.permissionBannerText}>
                You won't get alerts for matches, messages, or Waves until you enable notifications in your device settings.
              </Text>
            </View>
            <Text style={styles.permissionBannerArrow}>›</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.groupHeader} accessibilityRole="header">Account</Text>
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
              <Text style={styles.label}>New Phone Number</Text>
              <TextInput
                style={styles.input}
                placeholder="(555) 555-5555"
                placeholderTextColor={colors.textTertiary}
                keyboardType="phone-pad"
                value={newPhoneInput}
                onChangeText={setNewPhoneInput}
                accessibilityLabel="New phone number"
              />
              <TouchableOpacity
                style={styles.button}
                onPress={sendPhoneChangeOtp}
                activeOpacity={0.85}
                accessibilityLabel="Send verification code"
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>Send Verification Code</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setChangingPhone(false)}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel="Cancel"
                accessibilityRole="button"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.label}>Enter the code sent to {newPhoneInput}</Text>
              <TextInput
                style={styles.input}
                placeholder="6-digit code"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                value={otp}
                onChangeText={setOtp}
                accessibilityLabel="Verification code"
              />
              <TouchableOpacity
                style={styles.button}
                onPress={verifyPhoneChange}
                activeOpacity={0.85}
                accessibilityLabel="Confirm new number"
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>Confirm New Number</Text>
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
          accessibilityLabel={exporting ? 'Preparing export' : 'Request my data'}
          accessibilityRole="button"
        >
          <Text style={styles.signOutText}>{exporting ? 'Preparing export...' : 'Request My Data'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.deleteButton}
          onPress={confirmDeleteAccount}
          disabled={deleting}
          accessibilityLabel={deleting ? 'Deleting account' : 'Delete account, this permanently removes your profile and cannot be undone'}
          accessibilityRole="button"
        >
          <Text style={styles.deleteText}>
            {deleting ? 'Deleting account...' : 'Delete Account'}
          </Text>
        </TouchableOpacity>

        <Text
          style={styles.groupHeader}
          accessibilityRole="header"
          onLayout={(e) => { preferencesYRef.current = e.nativeEvent.layout.y; }}
        >
          Preferences
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
        <Text style={styles.sectionLabel} accessibilityRole="header">❤️ Dating Preferences</Text>
        <TouchableOpacity
          style={[styles.card, styles.settingRow]}
          onPress={() => navigation.navigate('DatingPreferences')}
          activeOpacity={0.8}
          accessibilityLabel="Dating Preferences, manage in your Dating Profile"
          accessibilityRole="button"
        >
          <Text style={styles.settingLabel}>Dating Preferences</Text>
          <Text style={styles.linkText}>Manage →</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('settings.appearance')}</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('settings.darkMode')}</Text>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="Dark mode"
            />
          </View>
          <View style={styles.divider} />
          <View style={{ paddingVertical: spacing.sm }}>
            <Text style={styles.settingLabel}>Nearby Display Style</Text>
            <Text style={styles.helperText}>Choose how profiles are shown in Nearby. Entirely optional — the list stays the default.</Text>
            <View style={[styles.chipsWrap, { marginTop: spacing.sm }]}>
              <TouchableOpacity
                style={[styles.chip, discoveryViewStyle === 'list' && styles.chipSelected]}
                onPress={() => updateDiscoveryViewStyle('list')}
                activeOpacity={0.8}
                accessibilityLabel="List view"
                accessibilityRole="button"
                accessibilityState={{ selected: discoveryViewStyle === 'list' }}
              >
                <Text style={[styles.chipText, discoveryViewStyle === 'list' && styles.chipTextSelected]}>📋 List</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, discoveryViewStyle === 'cards' && styles.chipSelected]}
                onPress={() => updateDiscoveryViewStyle('cards')}
                activeOpacity={0.8}
                accessibilityLabel="Card swipe view"
                accessibilityRole="button"
                accessibilityState={{ selected: discoveryViewStyle === 'cards' }}
              >
                <Text style={[styles.chipText, discoveryViewStyle === 'cards' && styles.chipTextSelected]}>🃏 Cards</Text>
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
              activeOpacity={0.8}
              accessibilityLabel="English"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'en' }}
            >
              <Text style={[styles.chipText, language === 'en' && styles.chipTextSelected]}>English</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'es' && styles.chipSelected]}
              onPress={() => setLanguage('es')}
              activeOpacity={0.8}
              accessibilityLabel="Español"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'es' }}
            >
              <Text style={[styles.chipText, language === 'es' && styles.chipTextSelected]}>Español</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'de' && styles.chipSelected]}
              onPress={() => setLanguage('de')}
              activeOpacity={0.8}
              accessibilityLabel="Deutsch"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'de' }}
            >
              <Text style={[styles.chipText, language === 'de' && styles.chipTextSelected]}>Deutsch</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'fr' && styles.chipSelected]}
              onPress={() => setLanguage('fr')}
              activeOpacity={0.8}
              accessibilityLabel="Français"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'fr' }}
            >
              <Text style={[styles.chipText, language === 'fr' && styles.chipTextSelected]}>Français</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'pt' && styles.chipSelected]}
              onPress={() => setLanguage('pt')}
              activeOpacity={0.8}
              accessibilityLabel="Português"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'pt' }}
            >
              <Text style={[styles.chipText, language === 'pt' && styles.chipTextSelected]}>Português</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'ht' && styles.chipSelected]}
              onPress={() => setLanguage('ht')}
              activeOpacity={0.8}
              accessibilityLabel="Kreyòl Ayisyen"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'ht' }}
            >
              <Text style={[styles.chipText, language === 'ht' && styles.chipTextSelected]}>Kreyòl Ayisyen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'zh' && styles.chipSelected]}
              onPress={() => setLanguage('zh')}
              activeOpacity={0.8}
              accessibilityLabel="中文"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'zh' }}
            >
              <Text style={[styles.chipText, language === 'zh' && styles.chipTextSelected]}>中文</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'vi' && styles.chipSelected]}
              onPress={() => setLanguage('vi')}
              activeOpacity={0.8}
              accessibilityLabel="Tiếng Việt"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'vi' }}
            >
              <Text style={[styles.chipText, language === 'vi' && styles.chipTextSelected]}>Tiếng Việt</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'tl' && styles.chipSelected]}
              onPress={() => setLanguage('tl')}
              activeOpacity={0.8}
              accessibilityLabel="Tagalog"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'tl' }}
            >
              <Text style={[styles.chipText, language === 'tl' && styles.chipTextSelected]}>Tagalog</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'ru' && styles.chipSelected]}
              onPress={() => setLanguage('ru')}
              activeOpacity={0.8}
              accessibilityLabel="Русский"
              accessibilityRole="button"
              accessibilityState={{ selected: language === 'ru' }}
            >
              <Text style={[styles.chipText, language === 'ru' && styles.chipTextSelected]}>Русский</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'ko' && styles.chipSelected]}
              onPress={() => setLanguage('ko')}
              activeOpacity={0.8}
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
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>💬 Social</Text>
              <Text style={styles.helperText}>Friend requests, matches, messages, and waves.</Text>
            </View>
            <Switch
              value={notifySocial}
              onValueChange={(v) => toggleNotifPref('notify_social', v, setNotifySocial)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="Notify me about social activity -- friend requests, matches, messages, and waves"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>🎯 Discovery</Text>
              <Text style={styles.helperText}>A new gathering or business that matches your interests.</Text>
            </View>
            <Switch
              value={notifyDiscovery}
              onValueChange={(v) => toggleNotifPref('notify_discovery', v, setNotifyDiscovery)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="Notify me when something new matches my interests"
            />
          </View>
          {notifyDiscovery && (
            <>
              <TouchableOpacity
                style={styles.customizeLink}
                onPress={() => setExpandedRecPanel(expandedRecPanel === 'things_to_do' ? null : 'things_to_do')}
                accessibilityLabel="Customize Things To Do notifications"
                accessibilityRole="button"
                accessibilityState={{ expanded: expandedRecPanel === 'things_to_do' }}
              >
                <Text style={styles.customizeLinkText}>
                  {expandedRecPanel === 'things_to_do' ? '⚙️ Hide Things To Do frequency, categories, distance & time' : '⚙️ Things To Do: frequency, categories, distance & time'}
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
                />
              )}
              <TouchableOpacity
                style={styles.customizeLink}
                onPress={() => setExpandedRecPanel(expandedRecPanel === 'nearby_opportunities' ? null : 'nearby_opportunities')}
                accessibilityLabel="Customize Nearby Opportunities notifications"
                accessibilityRole="button"
                accessibilityState={{ expanded: expandedRecPanel === 'nearby_opportunities' }}
              >
                <Text style={styles.customizeLinkText}>
                  {expandedRecPanel === 'nearby_opportunities' ? '⚙️ Hide Nearby Opportunities frequency, categories, distance & time' : '⚙️ Nearby Opportunities: frequency, categories, distance & time'}
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
                />
              )}
            </>
          )}
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>👋 Proximity</Text>
              <Text style={styles.helperText}>When you cross paths with someone nearby.</Text>
            </View>
            <Switch
              value={notifyProximity}
              onValueChange={(v) => toggleNotifPref('notify_proximity', v, setNotifyProximity)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="Notify me when I cross paths with someone nearby"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>📅 Planning</Text>
              <Text style={styles.helperText}>Gathering interest, approvals, and reminders as your plans come up.</Text>
            </View>
            <Switch
              value={notifyPlanning}
              onValueChange={(v) => toggleNotifPref('notify_planning', v, setNotifyPlanning)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="Notify me about plans I'm making -- gathering interest, approvals, and reminders"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>🏪 Business</Text>
              <Text style={styles.helperText}>A place you've interacted with has an offer or update -- or, if you manage a business, activity on your own listings.</Text>
            </View>
            <Switch
              value={notifyBusiness}
              onValueChange={(v) => toggleNotifPref('notify_business', v, setNotifyBusiness)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="Notify me about business offers and updates"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>🏘️ Community</Text>
              <Text style={styles.helperText}>New activity in a community you're part of.</Text>
            </View>
            <Switch
              value={notifyCommunity}
              onValueChange={(v) => toggleNotifPref('notify_community', v, setNotifyCommunity)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="Notify me about activity in my communities"
            />
          </View>
        </View>

        <Text style={styles.groupHeader} accessibilityRole="header">Privacy & Safety</Text>

        <Text style={styles.sectionLabel} accessibilityRole="header">Privacy</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Read Receipts</Text>
              <Text style={styles.helperText}>Let matches see when you've read their messages. Turning this off also hides when they've read yours.</Text>
            </View>
            <Switch
              value={readReceiptsEnabled}
              onValueChange={(v) => toggleNotifPref('read_receipts_enabled', v, setReadReceiptsEnabled)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="Read receipts"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>I Message First</Text>
              <Text style={styles.helperText}>When you match with someone, they won't be able to send a message until you send the first one.</Text>
            </View>
            <Switch
              value={womenMessageFirst}
              onValueChange={(v) => toggleNotifPref('women_message_first', v, setWomenMessageFirst)}
              trackColor={{ true: colors.primary, false: colors.border }}
              accessibilityLabel="I message first"
            />
          </View>
          <View style={styles.divider} />
          <View>
            <Text style={styles.settingLabel}>Who can see my requests</Text>
            <Text style={styles.helperText}>
              A "Coffee tonight?" request you post stays within Nearby's usual friends/matches-only
              boundary either way — this only controls whether a friend or match can see it as a
              suggested match for their own ask.
            </Text>
            <View style={[styles.chipsWrap, { marginTop: spacing.sm }]}>
              <TouchableOpacity
                style={[styles.chip, intentVisibility === 'friends_and_matches' && styles.chipSelected]}
                onPress={() => updateIntentVisibility('friends_and_matches')}
                accessibilityRole="button"
                accessibilityLabel="Friends & matches"
              >
                <Text style={[styles.chipText, intentVisibility === 'friends_and_matches' && styles.chipTextSelected]}>Friends & Matches</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, intentVisibility === 'nobody' && styles.chipSelected]}
                onPress={() => updateIntentVisibility('nobody')}
                accessibilityRole="button"
                accessibilityLabel="Nobody"
              >
                <Text style={[styles.chipText, intentVisibility === 'nobody' && styles.chipTextSelected]}>Nobody</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">Safety</Text>
        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('BlockedUsers')}
          activeOpacity={0.85}
          accessibilityLabel="Blocked users"
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>🚫 Blocked Users</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('IdVerification')}
          activeOpacity={0.85}
          accessibilityLabel="Verify your identity"
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>✓ Verify Identity</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('EmergencyContacts')}
          activeOpacity={0.85}
          accessibilityLabel="Emergency contacts"
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>🛡️ Emergency Contacts</Text>
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

        <Text style={styles.groupHeader} accessibilityRole="header">Connect</Text>
        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('Friends')}
          activeOpacity={0.85}
          accessibilityLabel="Friends, manage friend requests and see your friends list"
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>🤝 Friends</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('MusicMode')}
          activeOpacity={0.85}
          accessibilityLabel="Music Mode, connect Spotify and pick favorite tracks for your profile"
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>🎵 Music Mode</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('InviteFriends')}
          activeOpacity={0.85}
          accessibilityLabel="Invite friends"
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>🎁 Invite Friends</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('BrandOffers')}
          activeOpacity={0.85}
          accessibilityLabel="Offers and perks"
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>🎁 Offers & Perks</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('RelationshipHub')}
          activeOpacity={0.85}
          accessibilityLabel="Relationship, tools and reflection for a specific match or on your own"
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>❤️ Relationship</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <Text style={styles.groupHeader} accessibilityRole="header">Support</Text>
        <TouchableOpacity
          style={styles.rowButtonCard}
          onPress={() => navigation.navigate('FeaturesOverview')}
          activeOpacity={0.85}
          accessibilityLabel="Everything in Nearby, a guide to all features"
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>✨ Everything In Nearby</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

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
          accessibilityLabel="Sign out"
          accessibilityRole="button"
        >
          <Text style={styles.signOutText}>{signingOut ? 'Signing Out...' : 'Sign Out'}</Text>
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

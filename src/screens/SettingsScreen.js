import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, ScrollView, Switch } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { deleteAccount } from '../services/account';
import { requestDataExport } from '../services/dataExport';
import { ETHNICITY_OPTIONS } from '../constants/ethnicityOptions';
import { typography, spacing, radius } from '../theme';

const GENDER_OPTIONS = ['Men', 'Women', 'Other', 'Prefer not to say'];
const SHOW_ME_OPTIONS = ['Men', 'Women', 'Everyone'];

function toE164(rawInput) {
  const digits = rawInput.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export default function SettingsScreen({ navigation }) {
  const { isAdmin } = useAuth();
  const { colors, shadow, isDark, toggleTheme } = useTheme();
  const { t, language, setLanguage } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [userId, setUserId] = useState(null);
  const [discoveryGender, setDiscoveryGender] = useState('Prefer not to say');
  const [showMe, setShowMe] = useState('Everyone');
  const [minAge, setMinAge] = useState('18');
  const [maxAge, setMaxAge] = useState('99');
  const [genderHidden, setGenderHidden] = useState(false);
  const [myEthnicity, setMyEthnicity] = useState(null);
  const [ethnicityHidden, setEthnicityHidden] = useState(false);
  const [ethnicityPreferences, setEthnicityPreferences] = useState([]);

  const [notifyMatches, setNotifyMatches] = useState(true);
  const [notifyMessages, setNotifyMessages] = useState(true);
  const [notifyWaves, setNotifyWaves] = useState(true);

  const [changingPhone, setChangingPhone] = useState(false);
  const [newPhoneInput, setNewPhoneInput] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [e164NewPhone, setE164NewPhone] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    const id = sessionData?.session?.user?.id;
    setUserId(id);

    const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
    if (data) {
      setDiscoveryGender(data.discovery_gender || 'Prefer not to say');
      setShowMe(data.show_me || 'Everyone');
      setMinAge(String(data.preferred_min_age ?? 18));
      setMaxAge(String(data.preferred_max_age ?? 99));
      setNotifyMatches(data.notify_matches ?? true);
      setNotifyMessages(data.notify_messages ?? true);
      setNotifyWaves(data.notify_waves ?? true);
      setGenderHidden(data.gender_hidden ?? false);
      setMyEthnicity(data.ethnicity ?? null);
      setEthnicityHidden(data.ethnicity_hidden ?? false);
      setEthnicityPreferences(data.ethnicity_preferences ?? []);
    }
  }

  function toggleEthnicityPreference(option) {
    setEthnicityPreferences((prev) =>
      prev.includes(option) ? prev.filter((e) => e !== option) : [...prev, option]
    );
  }

  async function savePreferences() {
    const minAgeNum = parseInt(minAge, 10);
    const maxAgeNum = parseInt(maxAge, 10);

    if (isNaN(minAgeNum) || isNaN(maxAgeNum) || minAgeNum < 18 || maxAgeNum < minAgeNum) {
      return Alert.alert('Invalid range', 'Enter a valid age range (minimum 18).');
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        discovery_gender: discoveryGender,
        show_me: showMe,
        preferred_min_age: minAgeNum,
        preferred_max_age: maxAgeNum,
        ethnicity: myEthnicity,
        ethnicity_preferences: ethnicityPreferences,
      })
      .eq('id', userId);

    if (error) return Alert.alert('Error', error.message);
    Alert.alert('Saved');
  }

  async function toggleNotifPref(key, value, setter) {
    setter(value);
    const { error } = await supabase.from('profiles').update({ [key]: value }).eq('id', userId);
    if (error) {
      setter(!value);
      Alert.alert('Error', error.message);
    }
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
    await supabase.auth.signOut();
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
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.header}>{t('settings.title')}</Text>

        <Text style={styles.sectionLabel}>{t('settings.appearance')}</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('settings.darkMode')}</Text>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>{t('settings.language')}</Text>
        <View style={styles.card}>
          <View style={styles.chipsWrap}>
            <TouchableOpacity
              style={[styles.chip, language === 'en' && styles.chipSelected]}
              onPress={() => setLanguage('en')}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, language === 'en' && styles.chipTextSelected]}>English</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, language === 'es' && styles.chipSelected]}
              onPress={() => setLanguage('es')}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, language === 'es' && styles.chipTextSelected]}>Español</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionLabel}>{t('settings.notifications')}</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('settings.newMatches')}</Text>
            <Switch
              value={notifyMatches}
              onValueChange={(v) => toggleNotifPref('notify_matches', v, setNotifyMatches)}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('settings.messages')}</Text>
            <Switch
              value={notifyMessages}
              onValueChange={(v) => toggleNotifPref('notify_messages', v, setNotifyMessages)}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('settings.waves')}</Text>
            <Switch
              value={notifyWaves}
              onValueChange={(v) => toggleNotifPref('notify_waves', v, setNotifyWaves)}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>{t('settings.discoveryPreferences')}</Text>
        <View style={styles.card}>
          <Text style={styles.label}>{t('settings.showMe')}</Text>
          <View style={styles.chipsWrap}>
            {SHOW_ME_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, showMe === option && styles.chipSelected]}
                onPress={() => setShowMe(option)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, showMe === option && styles.chipTextSelected]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>{t('settings.ageRange')}</Text>
          <View style={styles.ageRow}>
            <TextInput
              style={[styles.input, styles.ageInput]}
              value={minAge}
              onChangeText={setMinAge}
              keyboardType="number-pad"
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={styles.ageDash}>to</Text>
            <TextInput
              style={[styles.input, styles.ageInput]}
              value={maxAge}
              onChangeText={setMaxAge}
              keyboardType="number-pad"
              placeholderTextColor={colors.textTertiary}
            />
          </View>

          <Text style={styles.label}>My Gender (for others' preferences)</Text>
          <View style={styles.chipsWrap}>
            {GENDER_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, discoveryGender === option && styles.chipSelected]}
                onPress={() => setDiscoveryGender(option)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, discoveryGender === option && styles.chipTextSelected]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.helperText}>
            This is separate from the "Gender" field on your profile — it's only used to match against other people's "Show Me" preference.
          </Text>

          <View style={[styles.settingRow, { marginTop: spacing.md }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Hide gender from my profile</Text>
              <Text style={styles.helperText}>Still used for matching, just not shown to others</Text>
            </View>
            <Switch
              value={genderHidden}
              onValueChange={(v) => toggleNotifPref('gender_hidden', v, setGenderHidden)}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>My Ethnicity</Text>
          <View style={styles.chipsWrap}>
            {ETHNICITY_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, myEthnicity === option && styles.chipSelected]}
                onPress={() => setMyEthnicity(myEthnicity === option ? null : option)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, myEthnicity === option && styles.chipTextSelected]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[styles.settingRow, { marginTop: spacing.sm }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Hide ethnicity from my profile</Text>
              <Text style={styles.helperText}>Still used for others' filtering, just not shown to others</Text>
            </View>
            <Switch
              value={ethnicityHidden}
              onValueChange={(v) => toggleNotifPref('ethnicity_hidden', v, setEthnicityHidden)}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Ethnicity Preferences (Optional)</Text>
          <View style={styles.chipsWrap}>
            {ETHNICITY_OPTIONS.map((option) => {
              const selected = ethnicityPreferences.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleEthnicityPreference(option)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helperText}>
            Select any you'd like to see more of. Leave empty to see everyone regardless of ethnicity.
          </Text>

          <TouchableOpacity style={styles.button} onPress={savePreferences} activeOpacity={0.85}>
            <Text style={styles.buttonText}>Save Preferences</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.card}>
          {!changingPhone ? (
            <TouchableOpacity style={styles.rowButton} onPress={() => setChangingPhone(true)}>
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
              />
              <TouchableOpacity style={styles.button} onPress={sendPhoneChangeOtp} activeOpacity={0.85}>
                <Text style={styles.buttonText}>Send Verification Code</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setChangingPhone(false)} style={{ marginTop: spacing.sm }}>
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
              />
              <TouchableOpacity style={styles.button} onPress={verifyPhoneChange} activeOpacity={0.85}>
                <Text style={styles.buttonText}>Confirm New Number</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.rowButtonCard} onPress={() => navigation.navigate('Paywall')} activeOpacity={0.85}>
          <Text style={styles.rowButtonText}>{t('settings.manageSubscription')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.rowButtonCard} onPress={() => navigation.navigate('Legal')} activeOpacity={0.85}>
          <Text style={styles.rowButtonText}>{t('settings.legal')}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        {isAdmin && (
          <TouchableOpacity style={styles.rowButtonCard} onPress={() => navigation.navigate('AdminReports')} activeOpacity={0.85}>
            <Text style={styles.rowButtonText}>Review Reports (Admin)</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.signOutButton} onPress={handleDataExport} disabled={exporting}>
          <Text style={styles.signOutText}>{exporting ? 'Preparing export...' : 'Request My Data'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteButton} onPress={confirmDeleteAccount} disabled={deleting}>
          <Text style={styles.deleteText}>
            {deleting ? 'Deleting account...' : 'Delete Account'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.lg },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  settingLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
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
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ageInput: { flex: 1, textAlign: 'center' },
  ageDash: { color: colors.textTertiary },
  helperText: { ...typography.small, color: colors.textTertiary, marginTop: spacing.sm, lineHeight: 16 },
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
  deleteText: { color: colors.primary, fontSize: 13, opacity: 0.7 },
});
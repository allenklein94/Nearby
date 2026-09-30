import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Platform, Alert, Share, Linking, ActivityIndicator } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { createCheckIn, buildShareMessage } from '../services/dateSafety';
import { startLiveTracking, stopLiveTracking, getMyActiveLiveTrackingSession } from '../services/liveTracking';
import { getMyEmergencyContacts } from '../services/emergencyContacts';
import { useTheme } from '../context/ThemeContext';
import { displayDateTime } from '../i18n/display';
import { spacing, radius, typography } from '../theme';

import { modalAnimation } from '../motion';
export default function DateCheckInModal({ visible, onClose, matchId, matchName, navigation, isRomanticMatch = true }) {
  const { t, language } = useLanguage();
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const [scheduledAt, setScheduledAt] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [showPicker, setShowPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [activeLiveSession, setActiveLiveSession] = useState(null);
  const [startingTracking, setStartingTracking] = useState(false);
  const [stoppingTracking, setStoppingTracking] = useState(false);
  const [emergencyContact, setEmergencyContact] = useState(null);

  React.useEffect(() => {
    if (visible) {
      getMyActiveLiveTrackingSession().then(setActiveLiveSession);
      getMyEmergencyContacts().then((contacts) => setEmergencyContact(contacts[0] ?? null));
    }
  }, [visible]);

  // Texts the saved contact directly (via the device's own SMS composer —
  // still a real tap the user has to send, no backend delivery) when one
  // exists; otherwise falls back to the generic share sheet, same as before
  // this contact feature existed.
  async function shareWithContact(message) {
    if (emergencyContact?.phone) {
      const separator = Platform.OS === 'ios' ? '&' : '?';
      const url = `sms:${emergencyContact.phone}${separator}body=${encodeURIComponent(message)}`;
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return;
      }
    }
    await Share.share({ message });
  }

  async function handleStartLiveTracking() {
    setStartingTracking(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('ui.dateCheckIn.locationNeeded'), t('ui.dateCheckIn.locationPermissionIsRequiredTo'));
        setStartingTracking(false);
        return;
      }
      const { sessionId, shareUrl, expiresAt } = await startLiveTracking(3);
      setActiveLiveSession({ id: sessionId, expires_at: expiresAt });
      await shareWithContact(t('ui.dateCheckIn.imSharingMyLiveLocation', { shareUrl: shareUrl }));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleStartLiveTracking() });
    }
    setStartingTracking(false);
  }

  async function handleStopLiveTracking() {
    setStoppingTracking(true);
    try {
      await stopLiveTracking(activeLiveSession.id);
      setActiveLiveSession(null);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleStopLiveTracking() });
    }
    setStoppingTracking(false);
  }

  async function handleCreate() {
    setSubmitting(true);
    try {
      await createCheckIn({ matchId, matchName, scheduledAt: scheduledAt.toISOString(), isRomanticMatch });

      const message = buildShareMessage(matchName, scheduledAt.toISOString(), language);
      await shareWithContact(message);

      Alert.alert(
        t('ui.dateCheckIn.youreAllSet'),
        isRomanticMatch
          ? t('ui.dateCheckIn.wellCheckInWithYou')
          : t('ui.dateCheckIn.wellCheckInWithYou2')
      );
      onClose();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleCreate() });
    }
    setSubmitting(false);
  }

  // A snapshot share, not continuous tracking — the person taps this
  // whenever they want a trusted contact to know exactly where they
  // are right now. Genuine live tracking would need a public web page
  // that updates in real time, which is a separate piece of
  // infrastructure beyond what this in-app share sheet can do.
  async function handleShareLocationNow() {
    setSharingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('ui.dateCheckIn.locationNeeded'), t('ui.dateCheckIn.locationAccessIsNeededTo'));
        setSharingLocation(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = location.coords;
      const mapsUrl = `https://maps.google.com/?q=${latitude},${longitude}`;

      await shareWithContact(matchName
        ? t('ui.dateCheckIn.currentlyHereWith', { name: matchName, url: mapsUrl })
        : t('ui.dateCheckIn.currentlyHereWithSomeone', { url: mapsUrl }));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleShareLocationNow() });
    }
    setSharingLocation(false);
  }

  return (
    <Modal visible={visible} animationType={modalAnimation('slide')} transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{isRomanticMatch ? t('ui.dateCheckIn.dateSafetyCheckIn') : t('ui.dateCheckIn.safetyCheckIn')}</Text>
          <Text style={styles.description}>
            {isRomanticMatch
              ? t('ui.dateCheckIn.setATimeForYour')
              : t('ui.dateCheckIn.setATimeForWhen')}
          </Text>
          {emergencyContact ? (
            <Text style={styles.contactHint}>{t('ui.dateCheckIn.sharingWillText', { name: emergencyContact.name })}</Text>
          ) : (
            navigation && (
              <TouchableOpacity onPress={() => { onClose(); navigation.navigate('EmergencyContacts'); }} accessibilityRole="button">
                <Text style={styles.contactHintLink}>{t('ui.dateCheckIn.noEmergencyContactSavedYet')}</Text>
              </TouchableOpacity>
            )
          )}

          <Text style={styles.label}>{t('ui.dateCheckIn.whenAreYouMeeting')}</Text>
          <TouchableOpacity style={styles.input} onPress={() => setShowPicker(true)}>
            <Text style={{ color: colors.textPrimary }}>
              {displayDateTime(scheduledAt.toISOString(), language)}
            </Text>
          </TouchableOpacity>
          {showPicker && (
            <DateTimePicker
              value={scheduledAt}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant={isDark ? 'dark' : 'light'}
              minimumDate={new Date()}
              onChange={(event, selectedDate) => {
                setShowPicker(Platform.OS === 'ios');
                if (selectedDate) setScheduledAt(selectedDate);
              }}
            />
          )}

          <TouchableOpacity style={styles.button} onPress={handleCreate} disabled={submitting} activeOpacity={0.85}>
            <Text style={styles.buttonText}>{submitting ? t('ui.dateCheckIn.settingUp') : t('ui.dateCheckIn.setUpCheckInShare')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.locationButton}
            onPress={handleShareLocationNow}
            disabled={sharingLocation}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.dateCheckIn.shareMyCurrentLocationRightA11y')}
            accessibilityRole="button"
          >
            {sharingLocation ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.locationButtonText}>{t('ui.dateCheckIn.shareMyLocationNow')}</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.locationHint}>{t('ui.dateCheckIn.aOneTimeSnapshotOf')}</Text>

          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.md }}>
            <Text style={styles.cancelText}>{t('ui.dateCheckIn.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.sm },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 20 },
  contactHint: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg },
  contactHintLink: { ...typography.caption, color: colors.primary, fontWeight: '700', marginBottom: spacing.lg },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  locationButton: {
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full,
    paddingVertical: 14, alignItems: 'center', marginTop: spacing.md,
  },
  locationButtonText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  locationHint: { ...typography.small, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xs },
  stopTrackingButton: { borderColor: colors.danger },
  stopTrackingButtonText: { color: colors.danger, fontWeight: '700', fontSize: 14 },
  cancelText: { color: colors.textTertiary, textAlign: 'center' },
});
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Platform, Alert, Share, ActivityIndicator } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { createCheckIn, buildShareMessage } from '../services/dateSafety';
import { startLiveTracking, stopLiveTracking, getMyActiveLiveTrackingSession } from '../services/liveTracking';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function DateCheckInModal({ visible, onClose, matchId, matchName }) {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const [scheduledAt, setScheduledAt] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [showPicker, setShowPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [activeLiveSession, setActiveLiveSession] = useState(null);
  const [startingTracking, setStartingTracking] = useState(false);
  const [stoppingTracking, setStoppingTracking] = useState(false);

  React.useEffect(() => {
    if (visible) {
      getMyActiveLiveTrackingSession().then(setActiveLiveSession);
    }
  }, [visible]);

  async function handleStartLiveTracking() {
    setStartingTracking(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Location permission is required to share your live location.');
        setStartingTracking(false);
        return;
      }
      const { sessionId, shareUrl, expiresAt } = await startLiveTracking(3);
      setActiveLiveSession({ id: sessionId, expires_at: expiresAt });
      await Share.share({
        message: `I'm sharing my live location with you for the next few hours as a safety check-in: ${shareUrl}`,
      });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setStartingTracking(false);
  }

  async function handleStopLiveTracking() {
    setStoppingTracking(true);
    try {
      await stopLiveTracking(activeLiveSession.id);
      setActiveLiveSession(null);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setStoppingTracking(false);
  }

  async function handleCreate() {
    setSubmitting(true);
    try {
      await createCheckIn({ matchId, matchName, scheduledAt: scheduledAt.toISOString() });

      const message = buildShareMessage(matchName, scheduledAt.toISOString());
      await Share.share({ message });

      Alert.alert(
        "You're all set",
        "We'll check in with you after your date, and you've had a chance to share your plans with someone you trust."
      );
      onClose();
    } catch (e) {
      Alert.alert('Error', e.message);
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
        Alert.alert('Location needed', 'Location access is needed to share your current spot.');
        setSharingLocation(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = location.coords;
      const mapsUrl = `https://maps.google.com/?q=${latitude},${longitude}`;

      await Share.share({
        message: `I'm currently here — sharing my location while I'm out with ${matchName || 'someone'}: ${mapsUrl}`,
      });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSharingLocation(false);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>🛡️ Date Safety Check-In</Text>
          <Text style={styles.description}>
            Set a time for your date. We'll check in with you afterward, and you can share your plans with a trusted contact.
          </Text>

          <Text style={styles.label}>When are you meeting?</Text>
          <TouchableOpacity style={styles.input} onPress={() => setShowPicker(true)}>
            <Text style={{ color: colors.textPrimary }}>
              {scheduledAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
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
            <Text style={styles.buttonText}>{submitting ? 'Setting up...' : 'Set Up Check-In & Share Plans'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.locationButton}
            onPress={handleShareLocationNow}
            disabled={sharingLocation}
            activeOpacity={0.85}
            accessibilityLabel="Share my current location right now"
            accessibilityRole="button"
          >
            {sharingLocation ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.locationButtonText}>📍 Share My Location Now</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.locationHint}>A one-time snapshot of where you are right now — not continuous tracking.</Text>

          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.md }}>
            <Text style={styles.cancelText}>Cancel</Text>
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
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },
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
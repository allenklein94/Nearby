import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { getGatheringRequestsForHost, approveInterest, hostRemoveAttendee } from '../services/gatherings';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// Host-only: approve/decline join requests and remove attendees, inline on
// GatheringDetail (the one place everything about a gathering is managed).
// Same RPCs and copy the Gatherings hosting list uses.
export default function HostAttendeeManager({ gatheringId, onChanged }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [rows, setRows] = useState(null);

  const load = useCallback(async () => {
    setRows(await getGatheringRequestsForHost(gatheringId));
  }, [gatheringId]);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    await load();
    onChanged?.();
  }

  async function handleApprove(row) {
    try {
      const result = await approveInterest(row.id);
      if (result?.status === 'waitlisted') {
        Alert.alert(t('ui.gatheringParts.gatheringFull'), t('ui.gatheringParts.thisGatheringIsAlreadyAt'));
      } else {
        Alert.alert(t('ui.gatheringParts.approved'), t('ui.gatheringParts.aMatchWasCreatedYou'));
      }
      refresh();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleApprove(row) });
    }
  }

  function confirmRemove(row, isRequest) {
    const name = row.profiles?.display_name ?? 'this person';
    Alert.alert(
      isRequest ? t('ui.gatheringParts.decline', { name: name }) : t('ui.gatheringParts.remove', { name: name }),
      isRequest ? t('ui.gatheringParts.theyllBeToldYouCouldnt') : t('ui.gatheringParts.theyllBeTakenOffThe'),
      [
        { text: t('ui.gatheringParts.cancel'), style: 'cancel' },
        {
          text: isRequest ? t('ui.gatheringParts.decline2') : t('ui.gatheringParts.remove2'),
          style: 'destructive',
          onPress: async () => {
            try {
              await hostRemoveAttendee(row.id);
              refresh();
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmRemove(row, isRequest) });
            }
          },
        },
      ]
    );
  }

  if (rows == null || rows.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('ui.gatheringParts.requestsAttendees')}</Text>
      {rows.map((row) => {
        const name = row.profiles?.display_name ?? t('ui.gatheringParts.someone');
        return (
          <View key={row.id} style={styles.row}>
            <Text style={styles.name}>{name}</Text>
            {row.status === 'pending' ? (
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => confirmRemove(row, true)} accessibilityLabel={t('ui.gatheringParts.declineSRequestA11y', { name: name })} accessibilityRole="button">
                  <Text style={styles.decline}>{t('ui.gatheringParts.decline2')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.approve} onPress={() => handleApprove(row)} accessibilityLabel={t('ui.gatheringParts.approveSRequestA11y', { name: name })} accessibilityRole="button">
                  <Text style={styles.approveText}>{t('ui.gatheringParts.approve')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.actions}>
                <Text style={styles.status}>{row.status === 'waitlisted' ? t('ui.gatheringParts.waitlisted') : t('ui.gatheringParts.approved2')}</Text>
                <TouchableOpacity onPress={() => confirmRemove(row, false)} accessibilityLabel={t('ui.gatheringParts.removeA11y', { name: name })} accessibilityRole="button">
                  <Text style={styles.decline}>{t('ui.gatheringParts.remove2')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
  name: { color: colors.textPrimary, fontSize: 14, flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  approve: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  approveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  decline: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  status: { color: colors.success, fontSize: 12, fontWeight: '700' },
});

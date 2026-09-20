import React, { useState, useEffect, useCallback } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { getGatheringRequestsForHost, approveInterest, hostRemoveAttendee } from '../services/gatherings';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// Host-only: approve/decline join requests and remove attendees, inline on
// GatheringDetail (the one place everything about a gathering is managed).
// Same RPCs and copy the Gatherings hosting list uses.
export default function HostAttendeeManager({ gatheringId, onChanged }) {
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
        Alert.alert('Gathering full', "This gathering is already at capacity — they've been added to the waitlist instead.");
      } else {
        Alert.alert('Approved!', 'A match was created — you can now chat with them.');
      }
      refresh();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleApprove(row) });
    }
  }

  function confirmRemove(row, isRequest) {
    const name = row.profiles?.display_name ?? 'this person';
    Alert.alert(
      isRequest ? `Decline ${name}?` : `Remove ${name}?`,
      isRequest ? "They'll be told you couldn't approve their request." : "They'll be taken off the list and a waitlisted person, if any, moves up.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isRequest ? 'Decline' : 'Remove',
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
      <Text style={styles.label}>Requests & attendees</Text>
      {rows.map((row) => {
        const name = row.profiles?.display_name ?? 'Someone';
        return (
          <View key={row.id} style={styles.row}>
            <Text style={styles.name}>{name}</Text>
            {row.status === 'pending' ? (
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => confirmRemove(row, true)} accessibilityLabel={`Decline ${name}'s request`} accessibilityRole="button">
                  <Text style={styles.decline}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.approve} onPress={() => handleApprove(row)} accessibilityLabel={`Approve ${name}'s request`} accessibilityRole="button">
                  <Text style={styles.approveText}>Approve</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.actions}>
                <Text style={styles.status}>{row.status === 'waitlisted' ? 'Waitlisted' : 'Approved'}</Text>
                <TouchableOpacity onPress={() => confirmRemove(row, false)} accessibilityLabel={`Remove ${name}`} accessibilityRole="button">
                  <Text style={styles.decline}>Remove</Text>
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

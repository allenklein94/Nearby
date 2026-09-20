import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Share } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import {
  getExperienceShares, shareExperienceWithFriend, createExperienceGuestLink, revokeExperienceShare, sharedNightGuestUrl,
} from '../services/plans';
import { getMyFriends } from '../services/friends';
import { getMyMatches } from '../services/matchActions';
import { shareCandidates, shareRowLabel } from '../utils/nightSharing';

// Owner-only "Share this night" panel. Everyone it adds is VIEW-ONLY (server-enforced): a friend/match you are already
// connected to (the picker only lists those, and the server refuses anyone else), or a named, expiring, revocable guest link.
export default function ExperienceSharePanel({ planId, planTitle }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [shares, setShares] = useState([]);
  const [people, setPeople] = useState(null); // null = picker closed
  const [guestOpen, setGuestOpen] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setShares(await getExperienceShares(planId)); } catch { /* supplementary */ }
  }, [planId]);
  useEffect(() => { load(); }, [load]);

  async function openPicker() {
    try {
      const [friends, matches] = await Promise.all([getMyFriends(), getMyMatches()]);
      setPeople(shareCandidates(friends, matches, shares));
    } catch (e) {
      Alert.alert("Couldn't load your friends", e.message);
    }
  }

  async function shareWith(person) {
    if (busy) return;
    setBusy(true);
    try {
      await shareExperienceWithFriend(planId, person.id);
      setPeople(null);
      await load();
    } catch (e) {
      Alert.alert("Couldn't share", e.message);
    }
    setBusy(false);
  }

  async function sendLink(token) {
    try {
      await Share.share({ message: `Here's our plan for the night${planTitle ? `: ${planTitle}` : ''}. ${sharedNightGuestUrl(token)}` });
    } catch { /* dismissed */ }
  }

  async function makeLink() {
    if (busy) return;
    setBusy(true);
    try {
      const link = await createExperienceGuestLink(planId, guestName);
      setGuestName('');
      setGuestOpen(false);
      await load();
      await sendLink(link.guestToken);
    } catch (e) {
      Alert.alert("Couldn't make the link", e.message);
    }
    setBusy(false);
  }

  function confirmRemove(share) {
    Alert.alert(
      share.kind === 'guest' ? `Turn off ${share.guestName}'s link?` : `Stop sharing with ${share.displayName}?`,
      share.kind === 'guest' ? 'The link stops working right away.' : "They won't see this night anymore.",
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Stop sharing', style: 'destructive', onPress: async () => { try { await revokeExperienceShare(share.id); await load(); } catch (e) { Alert.alert("Couldn't update", e.message); } } },
      ]
    );
  }

  return (
    <View>
      <Text style={styles.sectionLabel}>Share this night</Text>
      <View style={styles.card}>
        <Text style={styles.muted}>People you share it with can see the plan and where each stop stands. Only you can change it.</Text>

        {shares.map((s) => (
          <View key={s.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{shareRowLabel(s).title}</Text>
              <Text style={styles.muted}>{shareRowLabel(s).subtitle}</Text>
            </View>
            {s.kind === 'guest' && (
              <TouchableOpacity onPress={() => sendLink(s.guestToken)} accessibilityRole="button" accessibilityLabel={`Send ${s.guestName}'s link again`}>
                <Text style={styles.link}>Send</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => confirmRemove(s)} accessibilityRole="button" accessibilityLabel="Stop sharing">
              <Text style={[styles.link, { color: colors.danger, marginLeft: spacing.md }]}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}

        {people === null ? (
          <TouchableOpacity style={styles.action} onPress={openPicker} accessibilityRole="button">
            <Text style={styles.link}>+ Share with a friend</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.picker}>
            {people.length === 0 ? (
              <Text style={styles.muted}>No friends or matches to add yet.</Text>
            ) : people.map((p) => (
              <TouchableOpacity key={p.id} style={styles.row} onPress={() => shareWith(p)} disabled={busy} accessibilityRole="button" accessibilityLabel={`Share with ${p.display_name}`}>
                <Text style={styles.name}>{p.display_name}</Text>
                <Text style={styles.link}>Share</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setPeople(null)} accessibilityRole="button"><Text style={styles.muted}>Cancel</Text></TouchableOpacity>
          </View>
        )}

        {!guestOpen ? (
          <TouchableOpacity style={styles.action} onPress={() => setGuestOpen(true)} accessibilityRole="button">
            <Text style={styles.link}>+ Link for someone not on Nearby</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.picker}>
            <TextInput
              style={styles.input}
              value={guestName}
              onChangeText={setGuestName}
              placeholder="Their name"
              placeholderTextColor={colors.textSecondary}
              maxLength={40}
              autoFocus
              accessibilityLabel="Guest name"
            />
            <Text style={styles.muted}>View-only, works for 30 days, and you can turn it off any time.</Text>
            <View style={styles.row}>
              <TouchableOpacity onPress={makeLink} disabled={busy || !guestName.trim()} accessibilityRole="button">
                <Text style={[styles.link, (busy || !guestName.trim()) && { opacity: 0.4 }]}>Create and send link</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setGuestOpen(false); setGuestName(''); }} accessibilityRole="button"><Text style={[styles.muted, { marginLeft: spacing.md }]}>Cancel</Text></TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  sectionLabel: { color: colors.textSecondary, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: 'uppercase', fontSize: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  muted: { color: colors.textSecondary, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  name: { color: colors.textPrimary, fontWeight: '600' },
  link: { color: colors.primary, fontWeight: '700' },
  action: { paddingVertical: spacing.sm },
  picker: { marginTop: spacing.xs },
  input: { ...typography.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs },
});

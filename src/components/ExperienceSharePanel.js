import React, { useState, useCallback, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
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
  const { t } = useLanguage();
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
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => openPicker() });
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
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => shareWith(person) });
    }
    setBusy(false);
  }

  async function sendLink(token) {
    try {
      await Share.share({ message: planTitle ? t('ui.planDetail.shareMessageTitled', { title: planTitle, url: sharedNightGuestUrl(token) }) : t('ui.planDetail.shareMessage', { url: sharedNightGuestUrl(token) }) });
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
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => makeLink() });
    }
    setBusy(false);
  }

  function confirmRemove(share) {
    Alert.alert(
      share.kind === 'guest' ? t('ui.planDetail.turnOffSLink', { guestName: share.guestName }) : t('ui.planDetail.stopSharingWith', { name: share.displayName }),
      share.kind === 'guest' ? t('ui.planDetail.theLinkStopsWorkingRight') : t('ui.planDetail.theyWontSeeThisNight'),
      [
        { text: t('ui.planDetail.keep'), style: 'cancel' },
        { text: t('ui.planDetail.stopSharing'), style: 'destructive', onPress: async () => { try { await revokeExperienceShare(share.id); await load(); } catch (e) { presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmRemove(share) }); } } },
      ]
    );
  }

  return (
    <View>
      <Text style={styles.sectionLabel}>{t('ui.planDetail.shareThisNight')}</Text>
      <View style={styles.card}>
        <Text style={styles.muted}>{t('ui.planDetail.peopleYouShareItWith')}</Text>

        {shares.map((s) => (
          <View key={s.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{shareRowLabel(s).title}</Text>
              <Text style={styles.muted}>{shareRowLabel(s).subtitle}</Text>
            </View>
            {s.kind === 'guest' && (
              <TouchableOpacity onPress={() => sendLink(s.guestToken)} accessibilityRole="button" accessibilityLabel={t('ui.planDetail.sendSLinkAgainA11y', { guestName: s.guestName })}>
                <Text style={styles.link}>{t('ui.planDetail.send')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => confirmRemove(s)} accessibilityRole="button" accessibilityLabel={t('ui.planDetail.stopSharingA11y')}>
              <Text style={[styles.link, { color: colors.danger, marginLeft: spacing.md }]}>{t('ui.planDetail.remove')}</Text>
            </TouchableOpacity>
          </View>
        ))}

        {people === null ? (
          <TouchableOpacity style={styles.action} onPress={openPicker} accessibilityRole="button">
            <Text style={styles.link}>{t('ui.planDetail.shareWithAFriend')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.picker}>
            {people.length === 0 ? (
              <Text style={styles.muted}>{t('ui.planDetail.noFriendsOrMatchesTo')}</Text>
            ) : people.map((p) => (
              <TouchableOpacity key={p.id} style={styles.row} onPress={() => shareWith(p)} disabled={busy} accessibilityRole="button" accessibilityLabel={t('ui.planDetail.shareWithA11y', { name: p.display_name })}>
                <Text style={styles.name}>{p.display_name}</Text>
                <Text style={styles.link}>{t('ui.planDetail.share')}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setPeople(null)} accessibilityRole="button"><Text style={styles.muted}>{t('ui.planDetail.cancel')}</Text></TouchableOpacity>
          </View>
        )}

        {!guestOpen ? (
          <TouchableOpacity style={styles.action} onPress={() => setGuestOpen(true)} accessibilityRole="button">
            <Text style={styles.link}>{t('ui.planDetail.linkForSomeoneNotOn')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.picker}>
            <TextInput
              style={styles.input}
              value={guestName}
              onChangeText={setGuestName}
              placeholder={t('ui.planDetail.theirName')}
              placeholderTextColor={colors.textSecondary}
              maxLength={40}
              autoFocus
              accessibilityLabel={t('ui.planDetail.guestNameA11y')}
            />
            <Text style={styles.muted}>{t('ui.planDetail.viewOnlyWorksFor30')}</Text>
            <View style={styles.row}>
              <TouchableOpacity onPress={makeLink} disabled={busy || !guestName.trim()} accessibilityRole="button">
                <Text style={[styles.link, (busy || !guestName.trim()) && { opacity: 0.4 }]}>{t('ui.planDetail.createAndSendLink')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setGuestOpen(false); setGuestName(''); }} accessibilityRole="button"><Text style={[styles.muted, { marginLeft: spacing.md }]}>{t('ui.planDetail.cancel')}</Text></TouchableOpacity>
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

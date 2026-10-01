// The one "pick friends to invite" list for a gathering that does not exist yet (MakeAPlan; Create's "Who do you want to
// invite?" step, item 109). Accepted friends only (getFriendsWithSharedContext; never strangers, never inferred picks). It only
// SELECTS: the caller sends with sendGatheringInvites (services/invites.js) after the gathering is created. The post-publish
// panel on GatheringConfirmation sends one invite per tap and stays separate.
import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { NLoader } from '../motion';
import EmptyCopy from './EmptyCopy';
import { NearbyMark } from './brand';
import { supabase } from '../services/supabase';
import { getFriendsWithSharedContext } from '../services/gatherings';
import { getSignedPhotoUrl } from '../services/photos';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { selectedFriendIdList, keepEligible, selectionFromSuggested } from '../utils/inviteSelection';

// `suggestedIds`: friends an earlier step explicitly suggested (Celebrate Something's own picks); shown first with 🤝. Whether
// they start checked is the caller's initial selectedIds; anyone can be unchecked. Typed names never become suggestions.
export default function FriendInviteSelector({ selectedIds, onChange, navigation, suggestedIds = null }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const suggested = new Set(suggestedIds ?? []);
  const [friends, setFriends] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const myId = data?.session?.user?.id;
        const list = myId ? await getFriendsWithSharedContext(myId) : [];
        if (!alive) return;
        setFriends(list);
        // a picked (or suggested) person who is no longer an accepted friend is not kept selected
        const kept = keepEligible(selectedRef.current, list);
        if (Object.keys(kept).length !== selectedFriendIdList(selectedRef.current).length) onChange(kept);
        const urls = await Promise.all(list.map(async (f) => [f.id, f.photo_url ? await getSignedPhotoUrl(f.photo_url) : null]));
        if (alive) setPhotoUrls(Object.fromEntries(urls));
      } catch (e) {
        console.error('FriendInviteSelector load failed', e);
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  function toggle(id) {
    Haptics.selectionAsync();
    onChange({ ...selectedIds, [id]: !selectedIds[id] });
  }

  if (loading) return <NLoader fullScreen={false} size="inline" caption={t('ui.smallParts.loadingFriends')} />;
  if (friends.length === 0) {
    return (
      <View>
        <NearbyMark size={24} style={{ opacity: 0.3, alignSelf: 'center' }} />
        <EmptyCopy id="no_friends_to_invite" />
        <TouchableOpacity
          onPress={() => navigation.navigate('FriendDiscovery')}
          accessibilityLabel={t('ui.smallParts.discoverPeopleToAddAsA11y')}
          accessibilityRole="button"
          style={{ alignItems: 'center' }}
        >
          <Text style={styles.emptyActionText}>{t('ui.smallParts.discoverPeople')}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return [...friends].sort((a, b) => (suggested.has(b.id) ? 1 : 0) - (suggested.has(a.id) ? 1 : 0)).map((f) => {
    const selected = !!selectedIds[f.id];
    return (
      <TouchableOpacity
        key={f.id}
        style={styles.friendRow}
        onPress={() => toggle(f.id)}
        activeOpacity={0.85}
        accessibilityLabel={t(selected ? 'ui.smallParts.deselectA11y' : 'ui.smallParts.selectA11y', { name: f.display_name })}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
      >
        {photoUrls[f.id] ? <Image source={{ uri: photoUrls[f.id] }} style={styles.avatar} /> : <View style={styles.avatar} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.friendName}>{suggested.has(f.id) ? '🤝 ' : ''}{f.display_name}</Text>
          {f.sharedContext && <Text style={styles.friendContext}>{f.sharedContext}</Text>}
        </View>
        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
          {selected && <Text style={styles.checkboxMark}>✓</Text>}
        </View>
      </TouchableOpacity>
    );
  });
}

export { selectedFriendIdList, keepEligible, selectionFromSuggested };

const getStyles = (colors) => StyleSheet.create({
  emptyActionText: { color: colors.primary, fontWeight: '700', fontSize: 13, marginTop: -spacing.sm },
  friendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  friendName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  friendContext: { color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  checkbox: {
    width: 24, height: 24, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: '#fff', fontWeight: '800', fontSize: 14 },
});

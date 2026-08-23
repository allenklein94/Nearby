import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { getUnreadMessagesCount } from '../services/homeDashboard';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Aug 23 2026 Product Coherence Audit P2 (CLAUDE.md): these two icons
// have no on-screen affordance anywhere telling a first-time user they
// exist here at all (Messages/Profile both left the bottom tab bar in
// Phase 5) -- a small, real, shown-once hint closes that. Local-device-
// only (AsyncStorage, not a new profiles column/migration) -- this is
// purely "have you noticed this UI chrome," not something that needs to
// sync across a user's own devices the way the Home first-run moment's
// real content-bearing card does.
const HINT_SEEN_KEY = 'tab_header_actions_hint_seen';
const HINT_AUTO_HIDE_MS = 6000;

// Phase 5 of the "build everything" plan (see CLAUDE.md): the one
// genuinely new navigation mechanism this phase needs -- a persistent
// pair of header icons (Messages, Profile), both of which left the
// bottom tab bar this phase. Rendered inline by each of the 4 tab-root
// screens' own existing header area (Home/People/Create/Activity all
// build their own custom in-JS header, not React Navigation's native
// one, so there's no single `screenOptions.headerRight` that could cover
// all four at once) -- a real, disclosed scope boundary, not a silent
// gap: this renders on the 4 main tab screens, not on every one of the
// ~70 other pushed detail screens in the app.
export default function TabHeaderActions({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const hintTimerRef = useRef(null);

  const dismissHint = useCallback(() => {
    setShowHint(false);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    AsyncStorage.setItem(HINT_SEEN_KEY, 'true').catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(HINT_SEEN_KEY)
      .then((seen) => {
        if (cancelled || seen) return;
        setShowHint(true);
        hintTimerRef.current = setTimeout(dismissHint, HINT_AUTO_HIDE_MS);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, [dismissHint]);

  const load = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) return;

      const { data } = await supabase.from('profiles').select('photo_url').eq('id', userId).single();
      if (data?.photo_url) {
        setPhotoUrl(await getSignedPhotoUrl(data.photo_url));
      }

      const count = await getUnreadMessagesCount();
      setUnreadCount(count);
    } catch (e) {
      // Supplementary chrome, never worth blocking whichever real tab
      // screen this renders inside of -- same "non-fatal" convention this
      // app already uses for every other secondary header/banner fetch.
      console.error('TabHeaderActions load failed', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={styles.row}>
      <TouchableOpacity
        onPress={() => navigation.navigate('Messages')}
        style={styles.iconButton}
        accessibilityLabel={unreadCount > 0 ? `Messages, ${unreadCount} unread` : 'Messages'}
        accessibilityRole="button"
      >
        <Ionicons name="chatbubbles-outline" size={24} color={colors.textPrimary} />
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => navigation.navigate('Profile')}
        style={styles.iconButton}
        accessibilityLabel="Your Profile"
        accessibilityRole="button"
      >
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.avatar} />
        ) : (
          <Ionicons name="person-circle-outline" size={28} color={colors.textPrimary} />
        )}
      </TouchableOpacity>

      {showHint && (
        <View style={styles.hintBubble} pointerEvents="box-none">
          <Text style={styles.hintText}>💬 Messages and your profile live here now</Text>
          <TouchableOpacity onPress={dismissHint} accessibilityLabel="Dismiss this tip" accessibilityRole="button">
            <Text style={styles.hintDismiss}>Got it</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, position: 'relative' },
  iconButton: { padding: 2 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceElevated },
  badge: {
    position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  // Matches DiscoveryScreen's own calloutBanner/calloutText/calloutDismiss
  // visual language (neutral surface + border, neutral dismiss text per
  // the locked coral-usage rule -- this is informational chrome, not a
  // primary action) -- reworked into a floating card since, unlike that
  // screen's callout, there's no natural inline banner slot here across
  // the 4 different screens this component renders inside of.
  hintBubble: {
    position: 'absolute', top: '100%', right: 0, marginTop: spacing.sm, zIndex: 20, elevation: 20,
    width: 220, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  hintText: { ...typography.small, color: colors.textSecondary, lineHeight: 16, marginBottom: spacing.xs },
  hintDismiss: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', textAlign: 'right' },
});

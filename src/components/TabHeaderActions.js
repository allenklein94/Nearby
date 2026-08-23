import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { getUnreadMessagesCount } from '../services/homeDashboard';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';

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
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconButton: { padding: 2 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceElevated },
  badge: {
    position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});

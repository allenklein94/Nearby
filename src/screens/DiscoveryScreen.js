import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl } from 'react-native';
import { getNearbyMatches, reportPresence } from '../services/proximity';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import ReportBlockModal from '../components/ReportBlockModal';

export default function DiscoveryScreen({ navigation }) {
  const [nearby, setNearby] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});

  const load = useCallback(async () => {
    await reportPresence();
    const results = await getNearbyMatches();
    setNearby(results);

    // photo_url is a private storage path, not a public URL — resolve
    // each to a short-lived signed URL for display.
    const urlEntries = await Promise.all(
      results.map(async (item) => {
        const path = item.profiles?.photo_url;
        if (!path) return [item.id, null];
        const url = await getSignedPhotoUrl(path);
        return [item.id, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function sendNotice(toUserId) {
    const { data: sessionData } = await supabase.auth.getSession();
    const fromUserId = sessionData?.session?.user?.id;
    await supabase.from('notices').insert({ from_user: fromUserId, to_user: toUserId });
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Crossed Paths</Text>
      <Text style={styles.subheader}>People you've been near recently</Text>

      <FlatList
        data={nearby}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No crossed paths yet. Keep the app open while you're out and about.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Image
              source={{ uri: photoUrls[item.id] || 'https://placehold.co/100' }}
              style={styles.avatar}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.profiles?.display_name}</Text>
              <Text style={styles.bio} numberOfLines={2}>{item.profiles?.bio}</Text>
            </View>
            <TouchableOpacity style={styles.noticeButton} onPress={() => sendNotice(item.otherUserId)}>
              <Text style={styles.noticeButtonText}>Notice</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreButton}
              onPress={() => setReportTarget({ id: item.otherUserId, name: item.profiles?.display_name })}
            >
              <Text style={styles.moreButtonText}>⋯</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <ReportBlockModal
        visible={!!reportTarget}
        onClose={() => {
          setReportTarget(null);
          load();
        }}
        reportedUserId={reportTarget?.id}
        reportedUserName={reportTarget?.name}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', paddingHorizontal: 20, paddingTop: 10 },
  header: { fontSize: 28, fontWeight: '700', color: '#fff' },
  subheader: { fontSize: 14, color: '#8888a8', marginBottom: 20 },
  empty: { color: '#8888a8', textAlign: 'center', marginTop: 60, lineHeight: 20 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#2a2a4a',
    borderRadius: 16, padding: 12, marginBottom: 12,
  },
  avatar: { width: 56, height: 56, borderRadius: 28, marginRight: 12, backgroundColor: '#444' },
  name: { color: '#fff', fontSize: 16, fontWeight: '600' },
  bio: { color: '#c9c9e0', fontSize: 13, marginTop: 2 },
  noticeButton: { backgroundColor: '#e94560', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  noticeButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  moreButton: { paddingHorizontal: 10, paddingVertical: 8, marginLeft: 4 },
  moreButtonText: { color: '#8888a8', fontSize: 18, fontWeight: '700' },
});
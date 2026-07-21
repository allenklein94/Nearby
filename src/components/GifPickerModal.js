import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, FlatList, Image, ActivityIndicator } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

const GIPHY_API_KEY = 'o5pKU4HMe3qE4mQhC5rxZvSFHRZfombw';
const RATING = 'pg-13';

export default function GifPickerModal({ visible, onClose, onSelect }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (searchQuery) => {
    setLoading(true);
    try {
      const endpoint = searchQuery.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(searchQuery)}&limit=24&rating=${RATING}`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=${RATING}`;

      const response = await fetch(endpoint);
      const result = await response.json();
      setGifs(result.data || []);
    } catch (err) {
      console.error('GIF search failed', err);
      setGifs([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (visible) {
      search('');
    }
  }, [visible, search]);

  function handleSelect(gif) {
    onSelect(gif.images.original.url);
    setQuery('');
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search GIFs..."
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              search(text);
            }}
            autoFocus
          />
          <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : (
          <FlatList
            data={gifs}
            numColumns={2}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: spacing.sm }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.gifTile}
                onPress={() => handleSelect(item)}
                activeOpacity={0.8}
              >
                <Image
                  source={{ uri: item.images.fixed_width_small.url }}
                  style={styles.gifImage}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No GIFs found — try another search.</Text>
            }
          />
        )}

        <Text style={styles.attribution}>Powered by GIPHY</Text>
      </View>
    </Modal>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  searchInput: {
    flex: 1, backgroundColor: colors.surface, color: colors.textPrimary,
    borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm,
  },
  cancelButton: { paddingHorizontal: spacing.sm },
  cancelText: { color: colors.primary, fontWeight: '600' },
  gifTile: {
    flex: 1, aspectRatio: 1, margin: spacing.xs, borderRadius: radius.sm,
    overflow: 'hidden', backgroundColor: colors.surfaceElevated,
  },
  gifImage: { width: '100%', height: '100%' },
  emptyText: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xl },
  attribution: { color: colors.textTertiary, fontSize: 11, textAlign: 'center', paddingVertical: spacing.sm },
});
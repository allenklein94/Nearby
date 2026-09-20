import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { getSignedBusinessOfferMediaUrl } from '../services/businessFulfillment';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// A business's photo or video on an offer, shown INSIDE the offer card (never its own card).
// Video plays only when it has a poster: a poster exists only for videos whose sampled frames Nearby screened (Phase 2), so an
// older, unscreened video stays an honest "Video attached" label. Never autoplays: it shows the poster, the person taps play,
// and it starts MUTED (native controls let them unmute). Nothing plays inside a list.
export default function OfferMedia({ path, type, posterPath }) {
  const { colors } = useTheme();
  const [url, setUrl] = useState(null);
  const [poster, setPoster] = useState(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPlaying(false);
    if (path) {
      getSignedBusinessOfferMediaUrl(type === 'video' ? posterPath ?? null : path).then((u) => { if (!cancelled) setPoster(u); });
      if (type === 'video' && posterPath) getSignedBusinessOfferMediaUrl(path).then((u) => { if (!cancelled) setUrl(u); });
    }
    return () => { cancelled = true; };
  }, [path, type, posterPath]);

  if (!path) return null;
  const frame = { width: '100%', height: 180, borderRadius: radius.md, marginTop: spacing.xs, overflow: 'hidden' };

  if (type === 'video') {
    if (!posterPath) {
      return <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }}>🎬 Video attached</Text>;
    }
    if (playing && url) {
      return (
        <View style={frame}>
          <Video
            source={{ uri: url }}
            style={{ width: '100%', height: '100%' }}
            resizeMode={ResizeMode.CONTAIN}
            useNativeControls
            shouldPlay
            isMuted
            accessibilityLabel="Offer video, playing muted"
          />
        </View>
      );
    }
    return (
      <TouchableOpacity
        style={[frame, { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }]}
        onPress={() => setPlaying(true)}
        disabled={!url}
        accessibilityRole="button"
        accessibilityLabel="Play the offer video"
      >
        {poster ? <Image source={{ uri: poster }} style={{ ...StyleSheetAbsolute }} resizeMode="cover" /> : null}
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 22 }}>▶</Text>
        </View>
      </TouchableOpacity>
    );
  }

  if (!poster) return null;
  return <Image source={{ uri: poster }} style={frame} resizeMode="cover" />;
}

const StyleSheetAbsolute = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' };

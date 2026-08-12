import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';
import { useTheme } from '../context/ThemeContext';

// Same play/pause-a-signed-url pattern as ChatScreen's own VoiceBubble,
// pulled out here so it can be reused on Profile (preview your own
// voice intro) and ViewProfile (play someone else's) without a third
// copy of the same Audio.Sound lifecycle handling.
export default function VoicePlayButton({ getUrl, label = 'Voice message', style, iconSize = 18 }) {
  const { colors } = useTheme();
  const [sound, setSound] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  async function togglePlay() {
    if (playing && sound) {
      await sound.pauseAsync();
      setPlaying(false);
      return;
    }

    if (sound) {
      await sound.playAsync();
      setPlaying(true);
      return;
    }

    setLoading(true);
    const url = await getUrl();
    if (!url) {
      setLoading(false);
      return;
    }

    const { sound: newSound } = await Audio.Sound.createAsync(
      { uri: url },
      { shouldPlay: true },
      (status) => {
        if (status.didJustFinish) {
          setPlaying(false);
          newSound.setPositionAsync(0);
        }
      }
    );
    setSound(newSound);
    setPlaying(true);
    setLoading(false);
  }

  useEffect(() => {
    return () => {
      if (sound) sound.unloadAsync();
    };
  }, [sound]);

  return (
    <TouchableOpacity
      style={[styles.button, style]}
      onPress={togglePlay}
      activeOpacity={0.8}
      accessibilityLabel={`${label}, ${playing ? 'playing, tap to pause' : 'tap to play'}`}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Text style={{ fontSize: iconSize }}>{playing ? '⏸' : '▶️'}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { justifyContent: 'center', alignItems: 'center' },
});

import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { getSignedBusinessOfferMediaUrl } from '../services/businessFulfillment';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { mediaFitMode } from '../utils/mediaFit';

// Item 10: the business's own image, formatted to the frame. Shaped like the frame = fills it; any other shape (a flyer, a
// square graphic, a phone video's poster) = shown whole over a blurred copy of itself, so nothing the business made is cut.
function FittedImage({ uri, style, absolute = false, onFail }) {
  const [frame, setFrame] = useState(null);
  const [size, setSize] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setSize(null);
    if (uri) Image.getSize(uri, (w, h) => { if (!cancelled) setSize({ w, h }); }, () => {});
    return () => { cancelled = true; };
  }, [uri]);
  const mode = mediaFitMode(size?.w, size?.h, frame?.w, frame?.h);
  const fill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' };
  // The backdrop overhangs the frame so the blur's soft edge falls outside the clip (no light halo at the edges).
  const overhang = { position: 'absolute', top: -BLUR_OVERHANG, left: -BLUR_OVERHANG, right: -BLUR_OVERHANG, bottom: -BLUR_OVERHANG };
  return (
    <View
      style={[absolute ? fill : style, { overflow: 'hidden' }]}
      onLayout={(e) => setFrame({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {mode === 'contain' ? <Image source={{ uri }} style={overhang} resizeMode="cover" blurRadius={18} accessible={false} /> : null}
      <Image source={{ uri }} style={fill} resizeMode={mode} onError={onFail} />
    </View>
  );
}
const BLUR_OVERHANG = 48;

// A business's photo or video on an offer, shown INSIDE the offer card (never its own card).
// Video plays only when it has a poster: a poster exists only for videos whose sampled frames Nearby screened (Phase 2), so an
// older, unscreened video stays an honest "Video attached" label. Never autoplays: it shows the poster, the person taps play,
// and it starts MUTED (native controls let them unmute). Nothing plays inside a list.
export default function OfferMedia({ path, type, posterPath, localUri = null }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const [url, setUrl] = useState(null);
  const [poster, setPoster] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPlaying(false);
    setFailed(false);
    if (path) {
      getSignedBusinessOfferMediaUrl(type === 'video' ? posterPath ?? null : path).then((u) => { if (!cancelled) setPoster(u); });
      if (type === 'video' && posterPath) getSignedBusinessOfferMediaUrl(path).then((u) => { if (!cancelled) setUrl(u); });
    }
    return () => { cancelled = true; };
  }, [path, type, posterPath]);

  if (!path && !localUri) return null;
  const frame = { width: '100%', height: 180, borderRadius: radius.md, marginTop: spacing.xs, overflow: 'hidden' };

  // Owner preview only: the file the owner just picked, shown as-is before anything is uploaded.
  if (localUri) {
    if (type === 'video') {
      return (
        <View style={frame}>
          <Video source={{ uri: localUri }} style={{ width: '100%', height: '100%' }} resizeMode={ResizeMode.CONTAIN} useNativeControls isMuted accessibilityLabel={t('ui.requestDetail.offerVideoPreviewMutedA11y')} />
        </View>
      );
    }
    return failed ? null : <FittedImage uri={localUri} style={frame} onFail={() => setFailed(true)} />;
  }

  if (type === 'video') {
    if (!posterPath) {
      return <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }}>{t('ui.requestDetail.videoAttached')}</Text>;
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
            accessibilityLabel={t('ui.requestDetail.offerVideoPlayingMutedA11y')}
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
        accessibilityLabel={t('ui.requestDetail.playTheOfferVideoA11y')}
      >
        {poster ? <FittedImage uri={poster} absolute /> : null}
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 22 }}>▶</Text>
        </View>
      </TouchableOpacity>
    );
  }

  if (!poster || failed) return null;
  return <FittedImage uri={poster} style={frame} onFail={() => setFailed(true)} />;
}


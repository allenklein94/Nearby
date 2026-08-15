import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Modal, View, Image, TouchableOpacity, Text, StyleSheet, Dimensions, PanResponder, Animated, TextInput, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { getPhotoComments, addPhotoComment, deletePhotoComment } from '../services/photoComments';
import { checkTextModeration } from '../services/textModeration';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 120;
const DOUBLE_TAP_DELAY = 280;

// A full-screen photo viewer: swipe down to dismiss, double-tap to
// toggle zoom. Deliberately not a continuous pinch-to-zoom — that's
// genuinely hard to make reliable with PanResponder alone, and
// double-tap zoom is a well-established, simpler alternative that
// covers the actual need (seeing more detail) just as well.
//
// Comments are optional — only rendered when the caller passes
// photoOwnerId/photoRef/myUserId (today, only ViewProfileScreen does).
// photoRef is the same id ViewProfileScreen's own photos array already
// uses ('main' for the profile's main photo, the real profile_photos.id
// otherwise) — not a new id scheme invented for this.
export default function PhotoLightbox({ visible, photoUri, onClose, photoOwnerId, photoRef, myUserId }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const [isZoomed, setIsZoomed] = useState(false);
  const lastTapRef = useRef(0);
  const commentsEnabled = Boolean(photoOwnerId && photoRef);

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const loadComments = useCallback(async () => {
    if (!commentsEnabled) return;
    setLoadingComments(true);
    const data = await getPhotoComments(photoOwnerId, photoRef);
    setComments(data);
    setLoadingComments(false);
  }, [commentsEnabled, photoOwnerId, photoRef]);

  useEffect(() => {
    if (visible && commentsEnabled) {
      loadComments();
    }
    if (!visible) {
      // A closed lightbox always reopens to the photo view, not mid-comment-thread.
      setCommentsOpen(false);
      setDraft('');
    }
  }, [visible, commentsEnabled, loadComments]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => !isZoomed && !commentsOpen && Math.abs(gesture.dy) > 8,
      onPanResponderMove: Animated.event([null, { dy: translateY }], { useNativeDriver: false }),
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dy) > DISMISS_THRESHOLD) {
          handleClose();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: false }).start();
        }
      },
    })
  ).current;

  function handleClose() {
    translateY.setValue(0);
    scale.setValue(1);
    setIsZoomed(false);
    onClose();
  }

  function handleTap() {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      const zoomingIn = !isZoomed;
      setIsZoomed(zoomingIn);
      Animated.spring(scale, { toValue: zoomingIn ? 2 : 1, useNativeDriver: true }).start();
    }
    lastTapRef.current = now;
  }

  async function handleSend() {
    if (!draft.trim()) return;
    const check = await checkTextModeration(draft);
    if (!check.safe) {
      Alert.alert('Comment not allowed', 'Please rephrase your comment and try again.');
      return;
    }
    setSending(true);
    try {
      const added = await addPhotoComment(photoOwnerId, photoRef, draft.trim());
      setComments((prev) => [...prev, added]);
      setDraft('');
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSending(false);
  }

  function handleDelete(commentId) {
    Alert.alert('Delete comment?', 'This can\'t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePhotoComment(commentId);
            setComments((prev) => prev.filter((c) => c.id !== commentId));
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  }

  const backgroundOpacity = translateY.interpolate({
    inputRange: [-SCREEN_HEIGHT / 2, 0, SCREEN_HEIGHT / 2],
    outputRange: [0.3, 1, 0.3],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Animated.View style={[styles.overlay, { opacity: backgroundOpacity }]}>
        <TouchableOpacity style={styles.closeButton} onPress={handleClose} accessibilityLabel="Close photo" accessibilityRole="button">
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>

        {commentsEnabled && (
          <TouchableOpacity
            style={styles.commentsToggle}
            onPress={() => setCommentsOpen((prev) => !prev)}
            accessibilityLabel={commentsOpen ? 'Hide comments' : `Show comments${comments.length ? `, ${comments.length}` : ''}`}
            accessibilityRole="button"
          >
            <Text style={styles.commentsToggleText}>💬 {comments.length > 0 ? comments.length : ''}</Text>
          </TouchableOpacity>
        )}

        <Animated.View
          style={[styles.imageWrap, { transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity activeOpacity={1} onPress={handleTap}>
            <Animated.Image
              source={{ uri: photoUri }}
              style={[styles.image, { transform: [{ scale }] }]}
              resizeMode="contain"
              accessibilityLabel="Photo, double tap to zoom, swipe down to close"
            />
          </TouchableOpacity>
        </Animated.View>

        {commentsEnabled && commentsOpen && (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.commentsPanel}
          >
            <ScrollView style={styles.commentsList} keyboardShouldPersistTaps="handled">
              {loadingComments && <Text style={styles.commentsEmpty}>Loading comments...</Text>}
              {!loadingComments && comments.length === 0 && (
                <Text style={styles.commentsEmpty}>No comments yet — say something nice.</Text>
              )}
              {comments.map((c) => (
                <View key={c.id} style={styles.commentRow}>
                  <Text style={styles.commentText}>
                    <Text style={styles.commentAuthor}>{c.commenter?.display_name ?? 'Someone'}: </Text>
                    {c.comment_text}
                  </Text>
                  {(c.commenter_id === myUserId || photoOwnerId === myUserId) && (
                    <TouchableOpacity onPress={() => handleDelete(c.id)} accessibilityLabel="Delete this comment" accessibilityRole="button">
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                value={draft}
                onChangeText={setDraft}
                placeholder="Add a comment..."
                placeholderTextColor="rgba(255,255,255,0.5)"
                accessibilityLabel="Add a comment on this photo"
              />
              <TouchableOpacity onPress={handleSend} disabled={sending || !draft.trim()} accessibilityLabel="Post comment" accessibilityRole="button">
                <Text style={[styles.sendText, !draft.trim() && { opacity: 0.4 }]}>{sending ? '...' : 'Post'}</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  closeButton: {
    position: 'absolute', top: 50, right: 20, zIndex: 10,
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  closeButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  commentsToggle: {
    position: 'absolute', top: 50, left: 20, zIndex: 10,
    minWidth: 40, height: 40, borderRadius: 20, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center', flexDirection: 'row',
  },
  commentsToggleText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  imageWrap: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.85 },
  commentsPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: SCREEN_HEIGHT * 0.45,
    backgroundColor: 'rgba(20,20,20,0.96)', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingTop: 12,
  },
  commentsList: { paddingHorizontal: 16 },
  commentsEmpty: { color: 'rgba(255,255,255,0.6)', fontSize: 13, paddingVertical: 12 },
  commentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 8 },
  commentText: { color: '#fff', fontSize: 14, lineHeight: 19, flex: 1 },
  commentAuthor: { fontWeight: '700' },
  deleteText: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  commentInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.15)',
  },
  commentInput: {
    flex: 1, color: '#fff', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, fontSize: 14,
  },
  sendText: { color: '#4da3ff', fontWeight: '700', fontSize: 14 },
});

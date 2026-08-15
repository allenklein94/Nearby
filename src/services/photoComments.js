import { supabase } from './supabase';

// Comments on a specific photo, keyed by (photo_owner_id, photo_ref) --
// photo_ref is the same sentinel/id ViewProfileScreen's own photos array
// already uses ('main' for the profile's main photo, the real
// profile_photos.id for every extra photo), not a new id scheme.

export async function getPhotoComments(photoOwnerId, photoRef) {
  const { data, error } = await supabase
    .from('photo_comments')
    .select('id, comment_text, created_at, commenter_id, commenter:commenter_id(display_name, photo_url)')
    .eq('photo_owner_id', photoOwnerId)
    .eq('photo_ref', photoRef)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return data;
}

export async function addPhotoComment(photoOwnerId, photoRef, commentText) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('photo_comments')
    .insert({
      photo_owner_id: photoOwnerId,
      photo_ref: photoRef,
      commenter_id: user.id,
      comment_text: commentText.trim(),
    })
    .select('id, comment_text, created_at, commenter_id, commenter:commenter_id(display_name, photo_url)')
    .single();

  if (error) throw error;
  return data;
}

export async function deletePhotoComment(commentId) {
  const { error } = await supabase.from('photo_comments').delete().eq('id', commentId);
  if (error) throw error;
}

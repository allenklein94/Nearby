import { supabase } from './supabase';

// Same class of guard added to expressInterest() earlier — a self-
// notice shouldn't be reachable through normal UI (every list that
// calls this excludes the current user already), but that was also
// true of the gathering interest flow before it wasn't. Since a
// single self-notice row could trivially satisfy "mutual notice"
// match logic, this is worth guarding explicitly rather than relying
// on the UI alone.
export async function sendNoticeTo(toUserId, isWave = false) {
  const { data: sessionData } = await supabase.auth.getSession();
  const fromUserId = sessionData?.session?.user?.id;

  if (toUserId === fromUserId) {
    throw new Error('SELF_NOTICE_BLOCKED');
  }

  const { data: inserted, error: insertError } = await supabase
    .from('notices')
    .insert({ from_user: fromUserId, to_user: toUserId, is_super: isWave })
    .select()
    .single();

  if (!insertError) {
    return { noticeId: inserted.id, wasUpgrade: false };
  }

  if (insertError.code === '23505') {
    const { data: existing } = await supabase
      .from('notices')
      .select('id, is_super')
      .eq('from_user', fromUserId)
      .eq('to_user', toUserId)
      .maybeSingle();

    if (existing && isWave && !existing.is_super) {
      const { error: updateError } = await supabase
        .from('notices')
        .update({ is_super: true })
        .eq('id', existing.id);

      if (updateError) throw updateError;
      return { noticeId: existing.id, wasUpgrade: true };
    }

    throw new Error('ALREADY_SENT');
  }

  throw insertError;
}
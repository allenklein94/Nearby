import { supabase } from './supabase';

export async function sendNoticeTo(toUserId, isWave = false) {
  const { data: sessionData } = await supabase.auth.getSession();
  const fromUserId = sessionData?.session?.user?.id;

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
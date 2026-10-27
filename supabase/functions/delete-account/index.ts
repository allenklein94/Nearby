import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing auth' }), { status: 401 });
    }

    const supabaseAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });
    }
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const storagePaths: string[] = [];

    const { data: profile } = await admin.from('profiles').select('photo_url').eq('id', userId).single();
    if (profile?.photo_url) storagePaths.push(profile.photo_url);

    const { data: extraPhotos } = await admin.from('profile_photos').select('photo_url').eq('user_id', userId);
    for (const photo of extraPhotos ?? []) {
      if (photo.photo_url) storagePaths.push(photo.photo_url);
    }

    const { data: voiceMessages } = await admin
      .from('messages')
      .select('audio_url')
      .eq('sender_id', userId)
      .not('audio_url', 'is', null);
    for (const msg of voiceMessages ?? []) {
      if (msg.audio_url) storagePaths.push(msg.audio_url);
    }

    if (storagePaths.length > 0) {
      const { error: storageError } = await admin.storage.from('profile-photos').remove(storagePaths);
      if (storageError) {
        console.error('Storage cleanup failed (continuing anyway):', storageError.message);
      }
    }

    // ID verification photos live in a SEPARATE, private bucket and
    // are especially sensitive (government ID + selfie) — database
    // cascade deletes the row, but never touches the actual file
    // bytes, so this must be cleaned up explicitly or the images
    // would remain in storage forever after account deletion.
    const { data: verificationSubmissions } = await admin
      .from('id_verification_submissions')
      .select('selfie_path, id_photo_path')
      .eq('user_id', userId);

    const verificationPaths: string[] = [];
    for (const submission of verificationSubmissions ?? []) {
      if (submission.selfie_path) verificationPaths.push(submission.selfie_path);
      if (submission.id_photo_path) verificationPaths.push(submission.id_photo_path);
    }
    // Trust & safety fix 4 (2026-10-27): also every file in the person's own folder, so an upload that never got a
    // submission row (the app failed between upload and insert) is deleted too. Uploads can only go into this folder.
    for (let offset = 0; ; offset += 100) {
      const { data: files, error: listError } = await admin.storage.from('id-verification').list(userId, { limit: 100, offset });
      if (listError) {
        console.error('ID verification folder listing failed (continuing anyway):', listError.message);
        break;
      }
      for (const file of files ?? []) {
        const path = `${userId}/${file.name}`;
        if (!verificationPaths.includes(path)) verificationPaths.push(path);
      }
      if (!files || files.length < 100) break;
    }

    if (verificationPaths.length > 0) {
      const { error: verificationStorageError } = await admin.storage.from('id-verification').remove(verificationPaths);
      if (verificationStorageError) {
        console.error('ID verification storage cleanup failed (continuing anyway):', verificationStorageError.message);
      }
    }

    const { error: profileError } = await admin.from('profiles').delete().eq('id', userId);
    if (profileError) {
      return new Response(JSON.stringify({ error: `Failed to delete profile: ${profileError.message}` }), { status: 500 });
    }

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);
    if (authDeleteError) {
      return new Response(JSON.stringify({ error: `Failed to delete auth account: ${authDeleteError.message}` }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, filesRemoved: storagePaths.length + verificationPaths.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('delete-account error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
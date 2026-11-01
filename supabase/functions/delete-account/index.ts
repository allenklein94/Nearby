import { secretKey } from '../_shared/supabaseKeys.ts';
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = secretKey()!;

// Everything a deletion removes, in this order: the person's files (incl. ID verification), then the profile, then the auth
// user (guard: edgeFunctionSourcesGuard.test.js). Returns how many files were removed.
// deno-lint-ignore no-explicit-any
async function deleteEverything(admin: any, userId: string): Promise<number> {

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
    throw new Error(`Failed to delete profile: ${profileError.message}`);
  }

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);
  if (authDeleteError) {
    throw new Error(`Failed to delete auth account: ${authDeleteError.message}`);
  }

  return storagePaths.length + verificationPaths.length;
}

// The claims of a token getUser() has already verified (session_id + aal; 20270375 decides with them).
function verifiedClaims(token: string): { session_id?: string; aal?: string } {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)));
  } catch {
    return {};
  }
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing auth' }), { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 20270375 D2: the hourly job asks for the scheduled deletions that are due (service key only). Before each one the
    // account gets a last push ("deleted"), the confirmation Apple asks for when deletion isn't immediate.
    const payload = await req.json().catch(() => ({}));
    if (payload?.purge_due === true) {
      if (token !== SERVICE_ROLE_KEY) return json({ error: 'Not allowed' }, 403);
      const { data: due, error: dueError } = await admin.rpc('account_deletions_due');
      if (dueError) return json({ error: dueError.message }, 500);
      let done = 0;
      for (const userId of (due ?? []) as string[]) {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ recipient_id: userId, title: 'Your Nearby account has been deleted',
              body: 'Your account and its data were permanently deleted.', data: { type: 'account_security_notice' } }),
          }).catch(() => null);
          await deleteEverything(admin, userId);
          await admin.rpc('account_deletion_finished', { user_id_param: userId });
          done += 1;
        } catch (e) {
          console.error('scheduled deletion failed (kept for the next run):', String(e));
        }
      }
      return json({ ok: true, deleted: done });
    }

    const supabaseAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });
    }
    const userId = userData.user.id;

    // 20270375 D2: the server decides (switch off = 'legacy' = immediate, exactly as before). Refusals carry their hint.
    const claims = verifiedClaims(token);
    const { data: decision, error: decisionError } = await admin.rpc('account_deletion_authorize', {
      user_id_param: userId, session_id_param: claims.session_id ?? null, aal_param: claims.aal ?? null,
    });
    if (decisionError) {
      const known = ['account_on_hold', 'step_up_required', 'mfa_required', 'session_unknown'];
      if (known.includes(decisionError.hint ?? '')) return json({ error: decisionError.message, hint: decisionError.hint }, 403);
      // the function is missing (20270375 not live yet): exactly as before
      if (decisionError.code !== 'PGRST202') return json({ error: decisionError.message }, 500);
    }
    if (decision?.mode === 'scheduled') {
      return json({ ok: true, scheduled: true, purge_at: decision.purge_at });
    }

    const filesRemoved = await deleteEverything(admin, userId);
    return new Response(JSON.stringify({ ok: true, filesRemoved }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('delete-account error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

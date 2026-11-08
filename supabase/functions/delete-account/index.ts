import { secretKey } from '../_shared/supabaseKeys.ts';
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = secretKey()!;

const GENERIC_FAILURE = 'Failed to delete account';

// A failure stops the deletion and reaches an admin (counts only). Recording it must never hide the failure itself.
// deno-lint-ignore no-explicit-any
async function failed(admin: any, userId: string, step: string, detail: string): Promise<Error> {
  console.error(`account deletion stopped at ${step}:`, detail);
  try {
    await admin.rpc('account_deletion_record_failure', { user_id_param: userId, step_param: step });
  } catch (e) {
    console.error('recording the failure failed:', String(e));
  }
  return new Error(GENERIC_FAILURE); // the person never sees why: a database message could reveal a legal hold
}

// 20270402: evidence under an active legal hold is copied first; if that fails, nothing is deleted. The triggers on the two deletes
// below do the same in their own transactions, so a hold placed at any point is still honoured. Needs 20270402 live: without it this
// refuses, so deploy the migration first.
// deno-lint-ignore no-explicit-any
async function preserveHeldEvidence(admin: any, userId: string): Promise<void> {
  const { error } = await admin.rpc('account_deletion_preserve_held_evidence', { user_id_param: userId });
  if (error) throw await failed(admin, userId, 'preserve', error.message);
}

// Removes the files the database says are due, and returns how many Storage confirmed. The database queued them with the profile delete
// and re-checks each one for a hold at the moment it hands it over. Anything not confirmed stays queued for the hourly run.
// deno-lint-ignore no-explicit-any
async function removeDueFiles(admin: any, userId: string | null): Promise<number> {
  const { data: files, error } = await admin.rpc('account_file_cleanup_claim', { user_id_param: userId });
  if (error) {
    console.error('file cleanup claim failed (kept for the next run):', error.message);
    return 0;
  }
  const byBucket = new Map<string, string[]>();
  for (const f of (files ?? []) as { bucket_id: string; object_name: string }[]) {
    byBucket.set(f.bucket_id, [...(byBucket.get(f.bucket_id) ?? []), f.object_name]);
  }
  for (const [bucket, names] of byBucket) {
    const { error: storageError } = await admin.storage.from(bucket).remove(names);
    if (storageError) console.error('Storage cleanup failed (kept for the next run):', storageError.message);
  }
  const { data: confirmed, error: confirmError } = await admin.rpc('account_file_cleanup_confirm', { files_param: files ?? [] });
  if (confirmError) console.error('file cleanup confirm failed (kept for the next run):', confirmError.message);
  return confirmed ?? 0;
}

// A deletion, in this order: copy held evidence, delete the profile, delete the auth user, then remove the files. The files come last so
// a hold placed during the deletion can still keep them, and so a failed deletion hasn't already lost them.
// ID verification files aren't here: deleting the profile queues them for the hourly id-document-retention job (20270400).
// Deploy this version only AFTER 20270400 is live (before it, nothing would delete those files).
// deno-lint-ignore no-explicit-any
async function deleteEverything(admin: any, userId: string): Promise<number> {
  await preserveHeldEvidence(admin, userId);

  const { error: profileError } = await admin.from('profiles').delete().eq('id', userId);
  if (profileError) throw await failed(admin, userId, 'profile', profileError.message);

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);
  if (authDeleteError) throw await failed(admin, userId, 'auth', authDeleteError.message);

  return await removeDueFiles(admin, userId);
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
      if (dueError) {
        console.error('due deletions read failed:', dueError.message);
        return json({ error: GENERIC_FAILURE }, 500);
      }
      let done = 0;
      for (const userId of (due ?? []) as string[]) {
        try {
          // the copy first: a deletion that can't go ahead sends no notice
          await preserveHeldEvidence(admin, userId);
          await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ recipient_id: userId, title: 'Your Nearby account is being deleted',
              body: 'Your account and personal data are being deleted. We may keep limited records where the law or user safety requires it.',
              data: { type: 'account_security_notice' } }),
          }).catch(() => null);
          await deleteEverything(admin, userId);
          await admin.rpc('account_deletion_finished', { user_id_param: userId });
          done += 1;
        } catch (e) {
          console.error('scheduled deletion failed (kept for the next run):', String(e));
        }
      }
      // files still waiting: a removal that failed earlier, or a held file whose retention has passed
      const filesRemoved = await removeDueFiles(admin, null);
      return json({ ok: true, deleted: done, filesRemoved });
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
      if (decisionError.code !== 'PGRST202') {
        console.error('deletion check failed:', decisionError.message);
        return json({ error: GENERIC_FAILURE }, 500);
      }
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
    return new Response(JSON.stringify({ error: GENERIC_FAILURE }), { status: 500 });
  }
});

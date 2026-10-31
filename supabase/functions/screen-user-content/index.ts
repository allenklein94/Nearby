// screen-user-content (owner approved 2026-10-31; migration 20270373). NOT deployed: deploy only together with 20270373,
// with its own owner approval.
//
// Two callers:
//  1. The app, as the signed-in person, BEFORE it writes public text (profile text, gathering title/description, community
//     name/description, a Q&A question or answer, a photo comment):
//       POST { texts: [{ text, kind }] }  ->  { outcome, results: [{ outcome, languages }] }
//     outcome: 'publish' (write it), 'hold' (write it; a person checks it before anyone else sees it), 'refuse' (change
//     it). Screening that can't run = HTTP 503 { code: 'screening_unavailable' }: nothing is recorded, so the database
//     refuses the write too (fail closed). The database decides what a result means (record_ugc_screening ->
//     private.ugc_outcome_for, incl. the language-calibration rule); this function only reports what the classifier saw.
//     A text already screened for this person and still valid is not sent to the classifier again.
//  2. The cron job (private.ugc_chat_kick), with the service key: POST { mode: 'chat_batch' } screens queued community
//     and gathering group-chat messages after they were sent.
// Private 1:1 messages and group-plan chat never come here.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
import { secretKey } from '../_shared/supabaseKeys.ts';
import { classifyUserText, TEXT_KINDS, USER_CONTENT_MODEL } from '../_shared/userContentClassifier.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = secretKey();
const DAILY_AI_LIMIT = 300;
const MAX_TEXTS = 40;
const MAX_TEXT_LENGTH = 4000;
const NAME_KINDS = ['name', 'community_name'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function unavailable() {
  return json({ code: 'screening_unavailable', error: "We couldn't check this right now. Please try again in a moment." }, 503);
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Same trim as the database (private.ugc_norm): ASCII whitespace at both ends only, so both sides hash the same text.
export function normalizeText(text: string) {
  return text.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '');
}

const SEVERITY: Record<string, number> = { publish: 0, hold: 1, refuse: 2 };

async function screenForUser(admin: any, userId: string, body: any) {
  const raw = Array.isArray(body?.texts) ? body.texts : [];
  if (!raw.length || raw.length > MAX_TEXTS) return json({ error: 'texts is required' }, 400);
  const items = raw.map((t: any) => ({
    text: typeof t?.text === 'string' ? normalizeText(t.text) : '',
    kind: TEXT_KINDS.includes(t?.kind) && t.kind !== 'group_chat' ? t.kind : 'bio',
  }));
  if (items.some((i: any) => i.text.length > MAX_TEXT_LENGTH)) return json({ error: 'That text is too long.' }, 400);

  const results: { outcome: string; languages?: string[] }[] = [];
  for (const item of items) {
    if (!item.text) { results.push({ outcome: 'publish' }); continue; }
    const isName = NAME_KINDS.includes(item.kind);
    const sha = await sha256Hex(item.text);
    const { data: earlier, error: findError } = await admin.rpc('find_ugc_screening', {
      p_user: userId, p_text_sha256: sha, p_is_name: isName,
    });
    if (findError) { console.error('screen-user-content: lookup failed', findError.message); return unavailable(); }
    if (earlier === 'publish' || earlier === 'hold') { results.push({ outcome: earlier }); continue; }

    const { data: withinLimit, error: limitError } = await admin.rpc('check_and_increment_ai_use', {
      user_id_param: userId, daily_limit: DAILY_AI_LIMIT,
    });
    if (limitError) { console.error('screen-user-content: usage check failed', limitError.message); return unavailable(); }
    if (!withinLimit) return json({ code: 'usage_limit', error: "You've hit today's limit for this. It resets tomorrow." }, 429);

    const verdict = await classifyUserText(item.text, item.kind);
    if (!verdict) return unavailable();
    const { data: recorded, error: recordError } = await admin.rpc('record_ugc_screening', {
      p_user: userId, p_text_sha256: sha, p_kind: item.kind, p_is_name: isName, p_risk: verdict.riskTier,
      p_categories: verdict.matchedCategories, p_languages: verdict.languages, p_reasoning: verdict.reasoning,
      p_model: USER_CONTENT_MODEL,
    });
    if (recordError || !recorded?.outcome) {
      console.error('screen-user-content: could not record the result', recordError?.message);
      return unavailable();
    }
    results.push({ outcome: recorded.outcome, languages: verdict.languages });
  }
  const outcome = results.reduce((w, r) => (SEVERITY[r.outcome] > SEVERITY[w] ? r.outcome : w), 'publish');
  return json({ outcome, results });
}

async function screenChatBatch(admin: any) {
  const { data: batch, error } = await admin.rpc('claim_ugc_chat_batch', { p_limit: 20 });
  if (error) { console.error('screen-user-content: claim failed', error.message); return json({ error: 'claim failed' }, 500); }
  let screened = 0;
  for (const row of batch ?? []) {
    const verdict = await classifyUserText(String(row.body ?? '').slice(0, MAX_TEXT_LENGTH), 'group_chat');
    if (!verdict) {
      await admin.rpc('fail_ugc_chat_screening', { p_queue_id: row.queue_id, p_error: 'classifier unavailable' });
      continue;
    }
    const { error: recordError } = await admin.rpc('record_ugc_chat_screening', {
      p_queue_id: row.queue_id, p_risk: verdict.riskTier, p_categories: verdict.matchedCategories,
      p_languages: verdict.languages, p_reasoning: verdict.reasoning, p_model: USER_CONTENT_MODEL,
    });
    if (recordError) {
      await admin.rpc('fail_ugc_chat_screening', { p_queue_id: row.queue_id, p_error: String(recordError.message) });
    } else {
      screened += 1;
    }
  }
  return json({ claimed: (batch ?? []).length, screened });
}

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader || !SERVICE_ROLE_KEY) return json({ error: 'Missing auth' }, 401);
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => null);

    if (body?.mode === 'chat_batch') {
      if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) return json({ error: 'Not allowed' }, 403);
      return await screenChatBatch(admin);
    }

    const { data: userData, error: userError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !userData?.user) return json({ error: 'Invalid session' }, 401);
    return await screenForUser(admin, userData.user.id, body);
  } catch (err) {
    // Never fail open: an unexpected error records nothing, so the write is refused (screening_required).
    console.error('screen-user-content: SERVICE_FAILURE', String(err));
    return unavailable();
  }
});

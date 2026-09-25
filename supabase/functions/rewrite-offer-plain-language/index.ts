import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
import { classifyContent } from '../_shared/contentClassifier.ts';

// "See it in plain language" (owner item 59, 2026-09-25). A business owner has already typed their OWN offer
// title/description (which may be full of internal jargon, e.g. "Off-peak inventory optimization"); this function
// suggests a consumer-friendly rewrite of THAT TEXT ONLY. Locked rules (same pattern as read-offer-creative's
// "Read this for me", CLAUDE.md "Creative extraction"):
//  - Manual only: runs only when the owner taps the button. Nothing rewrites automatically.
//  - Suggestion-only: returns a suggestion and saves/sends NOTHING. The owner explicitly accepts or ignores it;
//    an ignored suggestion leaves the owner's original text exactly as written (item 59, owner LOCKED decision).
//  - SCHEMA-ENFORCED, not just prompted: the model's reply is only ever read for `title`/`description` strings.
//    Price, discount, dates, times, availability and restrictions are never part of the output shape, so the
//    model cannot alter them even if it tried -- they stay exactly what the owner already entered. The structured
//    facts are given only as CONTEXT so the rewrite doesn't contradict them (e.g. doesn't invent "50% off" when
//    the owner set 20%).
//  - No invented claims: the prompt explicitly forbids adding urgency, guarantees, "best/exclusive" language, or
//    any benefit/availability/condition the owner didn't already state.
//  - Deterministic claim guard (claimProblem, mirrored by src/utils/plainLanguageOffer.js, word lists tested
//    identical): a suggestion that adds a number, $/%/#, a day/time word or a marketing claim ("best",
//    "exclusive", "guaranteed", "free", "limited time"...) the owner's own text did not already contain is
//    withheld, never shown.
//  - Screening (owner decision): the owner's original text AND the suggestion are screened together here with the
//    shared classifier before anything is shown (not low = withheld; classifier down = 503, fail closed). The final
//    accepted text is screened again, unchanged, at Send (screen-business-content), like any owner-typed offer.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const DAILY_AI_LIMIT = 50;
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Pure validation of the model's reply (mirrored by src/utils/plainLanguageOffer.js, tested). The model's output
// shape has NO price/discount/date/time fields -- there is nothing for it to alter even on a bad reply.
export function sanitize(raw: any) {
  const clean = (v: unknown, max: number) => {
    if (typeof v !== 'string') return null;
    const t = v.replace(/\s+/g, ' ').trim().slice(0, max);
    return t || null;
  };
  return {
    title: clean(raw?.title, MAX_TITLE),
    description: clean(raw?.description, MAX_DESCRIPTION),
  };
}

// Word lists: keep identical to src/utils/plainLanguageOffer.js (a Jest test compares them).
export const PLAIN_LANGUAGE_CLAIM_WORDS = ['best', 'exclusive', 'exclusively', 'guarantee', 'guaranteed', 'hurry', 'free', 'unbeatable', 'lowest', 'cheapest', 'save', 'saving', 'savings', 'discount', 'discounted', 'half', 'percent', 'bonus', 'unlimited', 'instant', 'instantly'];
export const PLAIN_LANGUAGE_TIME_WORDS = ['today', 'tonight', 'tomorrow', 'weekend', 'weekday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'morning', 'afternoon', 'evening', 'midnight', 'noon', 'daily', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const PLAIN_LANGUAGE_CLAIM_PHRASES = ['limited time', 'last chance', 'act now', 'only today', 'number one', 'don\'t miss', 'while supplies last', 'first come', 'no catch'];

const words = (s: string) => (s || '').toLowerCase().match(/[a-z]+/g) || [];
const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const numbers = (s: string) => (s || '').match(/\d+(?:[.,]\d+)?/g) || [];

// null = only rewords the owner's text; otherwise a reason code (mirrors the client's claimProblem).
export function claimProblem(suggestion: { title: string | null; description: string | null }, original: { title?: string; description?: string }) {
  if (!suggestion.description) return 'empty';
  const src = `${original.title || ''} ${original.description || ''}`;
  const out = `${suggestion.title || ''} ${suggestion.description}`;
  const srcNums = new Set(numbers(src).map((n) => n.replace(',', '.')));
  if (numbers(out).some((n) => !srcNums.has(n.replace(',', '.')))) return 'number';
  for (const sym of ['$', '%', '#']) if (out.includes(sym) && !src.includes(sym)) return 'symbol';
  const srcWords = new Set(words(src).map(stem));
  const claim = new Set(PLAIN_LANGUAGE_CLAIM_WORDS.map(stem));
  const time = new Set(PLAIN_LANGUAGE_TIME_WORDS.map(stem));
  for (const w of words(out).map(stem)) {
    if (srcWords.has(w)) continue;
    if (claim.has(w)) return 'claim';
    if (time.has(w)) return 'time';
  }
  const srcLower = src.toLowerCase().replace(/\s+/g, ' ');
  const outLower = out.toLowerCase().replace(/\s+/g, ' ');
  if (PLAIN_LANGUAGE_CLAIM_PHRASES.some((p) => outLower.includes(p) && !srcLower.includes(p))) return 'claim';
  return null;
}

const WITHHELD = "We couldn't suggest wording that keeps your offer exactly as it is. Your own wording is unchanged.";

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing auth' }, 401);
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: userData, error: userError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !userData?.user) return json({ error: 'Invalid session' }, 401);
    const myId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { partnerId, title, description, price, discountPct, offerType, proposedTime, availableFrom, availableUntil, validUntilLabel, redemptionInstructions } = body;
    if (!partnerId || typeof partnerId !== 'string') return json({ error: 'Missing partnerId' }, 400);
    if (typeof description !== 'string' || !description.trim()) {
      return json({ error: 'Write your offer description first, then ask for a plain-language version.' }, 400);
    }

    const { data: profile } = await admin.from('profiles').select('managed_partner_id').eq('id', myId).single();
    if (!profile?.managed_partner_id || profile.managed_partner_id !== partnerId) {
      return json({ error: 'You do not manage this business' }, 403);
    }

    const { data: withinLimit } = await admin.rpc('check_and_increment_ai_use', { user_id_param: myId, daily_limit: DAILY_AI_LIMIT });
    if (!withinLimit) return json({ error: "You've hit today's usage limit. This resets tomorrow." }, 429);

    // Context facts, read-only for the model -- never part of its output schema, so it cannot change them.
    const facts: string[] = [];
    if (typeof price === 'number') facts.push(`Price: $${price}`);
    if (typeof discountPct === 'number') facts.push(`Discount: ${discountPct}% off`);
    if (offerType) facts.push(`Offer type: ${String(offerType).slice(0, 40)}`);
    if (proposedTime) facts.push('Has a specific proposed time.');
    if (availableFrom && availableUntil) facts.push('Has an available time window.');
    if (validUntilLabel) facts.push(`Valid until: ${String(validUntilLabel).slice(0, 40)}`);
    if (redemptionInstructions) facts.push('Has redemption instructions (unchanged, not part of this rewrite).');

    const prompt = `A local business owner wrote the following for a customer offer. Their own words may use internal business jargon a customer wouldn't recognize (e.g. "off-peak inventory optimization"). Rewrite ONLY the wording in plain, everyday language a customer would understand -- never change what is actually being offered.

Owner's title (may be empty): ${JSON.stringify(title ?? '')}
Owner's description: ${JSON.stringify(description)}
${facts.length ? `Known facts about this offer (for context only -- do not restate figures that aren't already in the owner's own text, and never invent a different price, discount, date, time or condition):\n${facts.map((f) => `- ${f}`).join('\n')}` : ''}

Rules:
- Preserve the actual offer exactly -- never add, remove, or change a price, discount, date, time, restriction, or redemption detail.
- Never invent urgency ("hurry", "limited time" unless the owner said so), guarantees, or superlative claims ("best", "exclusive", "guaranteed") the owner didn't use.
- Never add a benefit, availability claim, or condition the owner didn't state.
- Keep it short and factual, matching the owner's original length roughly.
- If the owner's text is already plain and simple, return it close to unchanged.

Reply with ONLY valid JSON in this exact shape, nothing else:
{"title":string|null,"description":string}`;

    let resp: Response;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        signal: AbortSignal.timeout(25000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
      });
    } catch (e) {
      console.error('rewrite-offer-plain-language: SERVICE_FAILURE request failed', String(e));
      return json({ error: "We couldn't do that right now. Your own wording is unchanged.", code: 'rewrite_unavailable' }, 503);
    }
    const data = await resp.json().catch(() => null);
    const text = data?.content?.[0]?.text?.trim();
    if (!text) {
      console.error('rewrite-offer-plain-language: SERVICE_FAILURE unexpected response', resp.status, JSON.stringify(data));
      return json({ error: "We couldn't do that right now. Your own wording is unchanged.", code: 'rewrite_unavailable' }, 503);
    }
    let parsed: any;
    try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch (_e) {
      return json({ error: "We couldn't make sense of that one. Your own wording is unchanged.", code: 'rewrite_unavailable' }, 503);
    }
    const suggestion = sanitize(parsed);
    if (!suggestion.description) {
      return json({ error: "We couldn't do that right now. Your own wording is unchanged.", code: 'rewrite_unavailable' }, 503);
    }
    // Deterministic guard first (free, no AI): nothing the owner didn't say may be added.
    const problem = claimProblem(suggestion, { title: typeof title === 'string' ? title : '', description });
    if (problem) {
      console.warn('rewrite-offer-plain-language: suggestion withheld by claim guard', problem);
      return json({ suggestion: null, withheld: 'claim', message: WITHHELD });
    }

    // Screen the owner's original text and the suggestion with the shared policy classifier before showing anything.
    const screening = await classifyContent(
      `Original offer title: ${title ?? ''}\nOriginal offer description: ${description}\n` +
      `Suggested title: ${suggestion.title ?? ''}\nSuggested description: ${suggestion.description}`
    );
    if (!screening) {
      return json({ error: "We couldn't do that right now. Your own wording is unchanged.", code: 'rewrite_unavailable' }, 503);
    }
    if (screening.riskTier !== 'low') {
      return json({ suggestion: null, withheld: 'screening', message: WITHHELD });
    }

    // Suggestion only: nothing is saved or sent here. The owner's own text stays the offer until they explicitly accept.
    return json({ suggestion });
  } catch (e) {
    console.error('rewrite-offer-plain-language error', String(e));
    return json({ error: "Something went wrong. Your own wording is unchanged." }, 500);
  }
});

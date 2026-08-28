import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
import { classifyContent } from '../_shared/contentClassifier.ts';

// Decision 6, Phase 5 (CLAUDE.md's Aug 27 2026 plan) -- the periodic
// re-sweep job's own real classify-and-log step. Cron-triggered only, via
// submit_business_content_resweeps() (SQL, see
// 20260910_business_content_resweep.sql) -- no real user session exists
// for a cron-triggered call, so this is `verify_jwt: false` at the
// gateway (confirmed live after deploy, not assumed) and authenticated
// instead by comparing the caller's own `Authorization: Bearer <token>`
// against the real service_role_key directly -- matching the established
// stripe-connect-webhook/revenuecat-webhook "verify_jwt: false, do your
// own internal check" precedent, simplified to a direct secret-equality
// check since the real caller here is this app's own SQL function (via
// net.http_post using the real service_role_key vault secret as its
// Bearer token), not a third-party webhook needing cryptographic
// signature verification.
//
// Given {targetType, targetId, partnerId}, reads the real *current* live
// content for that target (name/description/differentiator for
// business_profile; title/description for the other three), builds the
// identical content block shape the real-time screen-business-content
// path already uses, classifies via the shared contentClassifier module,
// and writes a real audit row via record_business_content_screening(...,
// source_param: 'resweep') -- content_snapshot captures the real content
// actually re-checked, submitted_by stays honestly null (nothing here
// was submitted by a person).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// The four target types this whole re-sweep job covers -- matches
// business_content_screening_results' own CHECK constraint, deliberately
// narrower than screen-business-content's full TARGET_TYPES list. `update`
// (an already-delivered broadcast) and `offer_response` (a committed
// reply to one specific request) are both real, one-time messages, not
// ongoing published state -- never re-swept, per the locked Phase 5
// design's own text.
const RESWEEP_TARGET_TYPES = ['business_profile', 'experience', 'offer', 'availability'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token || token !== SERVICE_ROLE_KEY) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const body = await req.json();
    const { targetType, targetId, partnerId } = body;
    if (!partnerId || typeof partnerId !== 'string') return json({ error: 'Missing partnerId' }, 400);
    if (!RESWEEP_TARGET_TYPES.includes(targetType)) {
      return json({ error: 'This content type is not re-swept.' }, 400);
    }

    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    let contentSnapshot: Record<string, unknown>;
    let contentBlock: string;

    if (targetType === 'business_profile') {
      const { data: partner } = await admin
        .from('brand_partners')
        .select('name, description, differentiator')
        .eq('id', partnerId)
        .single();
      if (!partner) {
        // The business no longer exists (or was deactivated between the
        // real due-batch query and this call actually resolving) -- an
        // honest no-op, never a fabricated screening result for content
        // that isn't there to re-check.
        return json({ noop: true, reason: 'partner no longer exists' });
      }
      contentSnapshot = { name: partner.name, description: partner.description, differentiator: partner.differentiator };
      contentBlock = `Business name: ${partner.name || ''}
Description: ${partner.description || '(none)'}
What makes them different: ${partner.differentiator || '(none)'}`;
    } else {
      if (!targetId || typeof targetId !== 'string') return json({ error: 'Missing targetId' }, 400);
      const tableByType: Record<string, string> = {
        experience: 'business_experiences',
        offer: 'brand_offers',
        availability: 'business_availability',
      };
      const { data: row } = await admin
        .from(tableByType[targetType])
        .select('title, description, partner_id')
        .eq('id', targetId)
        .single();
      // Real defense-in-depth: confirm the row genuinely still belongs to
      // this partner before ever screening or logging it -- same
      // ownership discipline every real-time target_id-scoped branch in
      // screen-business-content already carries. Also covers the honest
      // "deleted/deactivated between due-batch query and this call"
      // case, same as business_profile above.
      if (!row || row.partner_id !== partnerId) {
        return json({ noop: true, reason: 'target no longer exists or partner mismatch' });
      }
      contentSnapshot = { title: row.title, description: row.description };
      contentBlock = `Title: ${row.title || ''}
Description: ${row.description || '(none)'}`;
    }

    const result = await classifyContent(contentBlock);
    if (!result) return json({ error: 'Could not classify this content right now.' }, 500);
    const { riskTier, matchedCategories, reasoning } = result;

    const { data: screeningId, error: logError } = await admin.rpc('record_business_content_screening', {
      partner_id_param: partnerId,
      target_type_param: targetType,
      target_id_param: targetType === 'business_profile' ? null : targetId,
      submitted_by_param: null,
      content_snapshot_param: contentSnapshot,
      risk_tier_param: riskTier,
      matched_categories_param: matchedCategories,
      model_reasoning_param: reasoning,
      source_param: 'resweep',
    });
    if (logError) {
      console.error('resweep-business-content: failed to log screening result', logError);
      return json({ error: 'Could not log the screening result.' }, 500);
    }

    return json({ riskTier, screeningId });
  } catch (err) {
    console.error('resweep-business-content error:', err);
    return json({ error: String(err) }, 500);
  }
});

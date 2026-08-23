-- "The Plan Engine" Phase 4 (CLAUDE.md, "The Plan Engine" section) -- closes the doc's own
-- named VISIT -> FEEDBACK -> NEXT PLAN loop by feeding real, already-captured post-visit
-- feedback (gathering_feedback, business_offer_outcomes) into the Home recommendation engine's
-- own scoring. No new feedback mechanism -- both tables already exist and already capture this
-- signal; this is a new, narrow, internal-auth.uid()-only consumer of them, matching every other
-- RPC of this shape elsewhere in this schema (no caller-supplied id).
--
-- Built as one RPC rather than two plain client queries specifically because
-- business_request_offers' own client-facing read shape (needed to join offer_id -> partner_id)
-- was not independently re-verified this pass -- a narrow SECURITY DEFINER function avoids
-- relying on an assumption about that table's RLS.

CREATE FUNCTION public.get_my_positive_experience_signals()
 RETURNS TABLE(host_ids uuid[], partner_ids uuid[])
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce(
      (select array_agg(distinct g.host_id)
       from gathering_feedback gf
       join gatherings g on g.id = gf.gathering_id
       where gf.reviewer_id = auth.uid()
         and gf.satisfaction_rating in ('loved_it', 'good')
         and gf.would_attend_again = true
         and g.host_id <> auth.uid()),
      array[]::uuid[]
    ),
    coalesce(
      (select array_agg(distinct bro.partner_id)
       from business_offer_outcomes boo
       join business_request_offers bro on bro.id = boo.offer_id
       where boo.reviewer_id = auth.uid()
         and boo.satisfaction_rating in ('loved_it', 'good')
         and boo.would_repeat in ('yes', 'maybe')),
      array[]::uuid[]
    );
$function$;

REVOKE ALL ON FUNCTION public.get_my_positive_experience_signals() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_positive_experience_signals() TO authenticated;

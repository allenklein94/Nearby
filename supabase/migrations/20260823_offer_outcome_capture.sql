-- Closes the real, named gap from CLAUDE.md's "Offer System Phase 6" writeup: "the vision
-- doc's own closing 'Outcome' node (Sec 16, 21 -- 'whether it worked') has no home anywhere in
-- this plan. complete_business_reservation() closes the loop as 'completed' with no rating/
-- feedback capture." Built per direct user instruction, mirroring gathering_feedback's own
-- existing shape (satisfaction_rating four-option scale, a "would you do this again" question,
-- optional free text) rather than inventing a second feedback system -- explicitly NOT a public
-- review platform: this is private, consumer-only, feeds business reliability/matching signal,
-- never shown to the business as raw text.
--
-- Unlike gathering_feedback (a plain client-writable table, reviewer-scoped RLS), writes here go
-- through a real SECURITY DEFINER RPC, matching this whole business_requests/offers ecosystem's
-- own established "no direct client INSERT on a table this schema mediates through RPCs"
-- convention. Only the real requester -- not the business -- ever gets to leave this feedback,
-- same "only the attendee rates, never the host" precedent gathering_feedback already set.

CREATE TABLE public.business_offer_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL UNIQUE REFERENCES public.business_request_offers(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  satisfaction_rating text NOT NULL CHECK (satisfaction_rating IN ('loved_it', 'good', 'okay', 'not_for_me')),
  would_repeat text NOT NULL CHECK (would_repeat IN ('yes', 'maybe', 'no')),
  feedback_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_offer_outcomes ENABLE ROW LEVEL SECURITY;

-- Only the real reviewer can ever read their own submission back (e.g. to
-- show "you already rated this" in the UI) -- the business never gets
-- row-level access to this table at all, only the aggregate percentages
-- get_partner_offer_reputation() computes server-side (see below).
CREATE POLICY "Reviewers can read their own offer outcomes"
  ON public.business_offer_outcomes FOR SELECT
  USING (auth.uid() = reviewer_id);

REVOKE ALL ON public.business_offer_outcomes FROM public, anon;
GRANT SELECT ON public.business_offer_outcomes TO authenticated;

CREATE FUNCTION public.submit_offer_outcome(
  offer_id_param uuid,
  satisfaction_rating_param text,
  would_repeat_param text,
  feedback_text_param text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer record;
  v_requester_id uuid;
begin
  select * into v_offer from business_request_offers where id = offer_id_param;
  if v_offer is null then
    raise exception 'Offer not found.';
  end if;
  if v_offer.status <> 'completed' then
    raise exception 'You can only share feedback once this is marked complete.';
  end if;

  select requester_id into v_requester_id from business_requests where id = v_offer.request_id;
  if auth.uid() <> v_requester_id then
    raise exception 'Only the person who made this request can share feedback on it.';
  end if;

  if satisfaction_rating_param not in ('loved_it', 'good', 'okay', 'not_for_me') then
    raise exception 'Invalid satisfaction rating.';
  end if;
  if would_repeat_param not in ('yes', 'maybe', 'no') then
    raise exception 'Invalid would-repeat value.';
  end if;

  begin
    insert into business_offer_outcomes (offer_id, reviewer_id, satisfaction_rating, would_repeat, feedback_text)
    values (offer_id_param, auth.uid(), satisfaction_rating_param, would_repeat_param, nullif(trim(coalesce(feedback_text_param, '')), ''));
  exception when unique_violation then
    raise exception 'You''ve already shared feedback for this.';
  end;

  return jsonb_build_object('success', true);
end;
$function$;

REVOKE ALL ON FUNCTION public.submit_offer_outcome(uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_offer_outcome(uuid, text, text, text) TO authenticated;

-- get_partner_offer_reputation()'s return shape changes (two new columns), so the old signature
-- is explicitly dropped first, matching this schema's own established "an added output column
-- creates a distinct orphaned overload, it doesn't replace the old one" lesson. Every existing
-- column/value is byte-for-byte unchanged -- only the two new, honestly nullif-guarded satisfaction
-- columns are added, computed from a real left join so a partner with zero ratings yet still gets
-- every existing column correct, with the two new ones simply null (never a fabricated default).
DROP FUNCTION IF EXISTS public.get_partner_offer_reputation(uuid);

CREATE FUNCTION public.get_partner_offer_reputation(partner_id_param uuid)
 RETURNS TABLE(
   total_opportunities bigint,
   responded_count bigint,
   response_rate numeric,
   accepted_count bigint,
   acceptance_rate numeric,
   completed_count bigint,
   completion_rate numeric,
   rated_count bigint,
   pct_satisfied numeric,
   pct_would_repeat numeric
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    count(*),
    count(*) filter (where bro.responded_at is not null),
    round(100.0 * count(*) filter (where bro.responded_at is not null) / nullif(count(*), 0), 1),
    count(*) filter (where bro.status in ('accepted', 'completed')),
    round(100.0 * count(*) filter (where bro.status in ('accepted', 'completed')) / nullif(count(*) filter (where bro.responded_at is not null), 0), 1),
    count(*) filter (where bro.status = 'completed'),
    round(100.0 * count(*) filter (where bro.status = 'completed') / nullif(count(*) filter (where bro.status in ('accepted', 'completed')), 0), 1),
    count(boo.id),
    round(100.0 * count(boo.id) filter (where boo.satisfaction_rating in ('loved_it', 'good')) / nullif(count(boo.id), 0), 1),
    round(100.0 * count(boo.id) filter (where boo.would_repeat = 'yes') / nullif(count(boo.id), 0), 1)
  from business_request_offers bro
  left join business_offer_outcomes boo on boo.offer_id = bro.id
  where bro.partner_id = partner_id_param;
$function$;

REVOKE ALL ON FUNCTION public.get_partner_offer_reputation(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_partner_offer_reputation(uuid) TO authenticated;

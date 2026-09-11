-- Item 46 follow-up (CLAUDE.md, "personalization should determine what
-- appears first" -- the "mainly uses Friends should have Friends content
-- prioritized" example, deliberately deferred at the time as "needs new
-- durable server-side usage-frequency instrumentation, not fabricated
-- from what already exists"). This is that instrumentation.
--
-- Discover's People > Dating|Friends sub-mode used to default purely from
-- AsyncStorage's own "last used" value (discover_last_people_submode) --
-- a real signal, but a single anomalous visit to the other mode flips it
-- immediately, which isn't what "mainly uses" means. Two plain counter
-- columns (same established "counter columns on profiles" pattern this
-- schema already uses elsewhere), incremented by a narrow, self-scoped
-- RPC every real time a person actually selects a sub-mode
-- (selectPeopleSubMode() in DiscoverHubScreen.js). The client-side pure
-- function that actually decides the default (resolveDefaultPeopleSubMode(),
-- src/utils/peopleSubModePreference.js) only lets this override the
-- remembered last-used value once there's a real, clearly skewed signal
-- (5+ combined uses, not a tie) -- otherwise it falls back to the existing
-- last-used/default behavior untouched, same "don't over-personalize too
-- early" discipline as item 47.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS people_submode_dating_uses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS people_submode_friends_uses integer NOT NULL DEFAULT 0;

-- A plain usage counter, not a privileged column (unlike is_premium/
-- managed_partner_id) -- no app.trusted_update guard needed, a single
-- arithmetic UPDATE on one's own row is already atomic and self-scoped.
CREATE OR REPLACE FUNCTION record_people_submode_use(submode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF submode NOT IN ('dating', 'friends') THEN
    RAISE EXCEPTION 'invalid submode: %', submode;
  END IF;

  IF submode = 'dating' THEN
    UPDATE profiles SET people_submode_dating_uses = people_submode_dating_uses + 1 WHERE id = auth.uid();
  ELSE
    UPDATE profiles SET people_submode_friends_uses = people_submode_friends_uses + 1 WHERE id = auth.uid();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION record_people_submode_use(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_people_submode_use(text) TO authenticated;

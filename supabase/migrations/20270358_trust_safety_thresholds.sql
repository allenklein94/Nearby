-- Trust & safety thresholds (owner decisions 2026-10-29) for the mechanisms in 20270356 (I2 rate limits) and 20270357
-- (I1 duplicate photo signals). Staged after 20270357; deploy only with its own approval. Changing a number later = a new
-- migration, never an edit of this one once deployed.
--
-- Principles applied:
--   * established = verified phone AND an account at least 7 days old; age alone (no phone) never qualifies.
--   * Account age never raises an UNSOLICITED-outreach limit: business messages, business requests and commercial posts
--     have the same numbers at both levels. Only activity inside a relationship the other person accepted (1:1 chats =
--     mutual matches only, group chats = members / attendees, invitations = friends only) gets more room when established.
--   * Reports: 10 a day for ordinary reasons; urgent safety reasons (harassment / abuse, underage user) are not counted
--     against that and have their own ceiling of 30 a day (flood protection only).
--   * Commercial posts (public gathering / community carrying a link, email or phone number): 3 a day, 10 a week.
--   * Duplicate photos: a review case when the same file is in use on 3 accounts, or on 2 accounts whose names are
--     similar (trigram >= 0.5). A similar name alone never opens anything; a case never acts on an account.
--   * Refusal = "You've reached the limit for this for now. Please try again later." (hint rate_limited).

update private.trust_settings set established_min_account_age = interval '7 days', updated_at = now() where id;

insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values
  -- 1:1 messages (inside a mutual match only)
  ('direct_message',   'new',         60,      10),
  ('direct_message',   'new',         86400,   200),
  ('direct_message',   'established', 60,      20),
  ('direct_message',   'established', 86400,   500),
  -- gathering + community + plan chats together (members / attendees)
  ('group_message',    'new',         60,      10),
  ('group_message',    'new',         86400,   150),
  ('group_message',    'established', 60,      20),
  ('group_message',    'established', 86400,   400),
  -- business conversations (can be unsolicited: same at both levels)
  ('business_message', 'new',         60,      5),
  ('business_message', 'new',         86400,   50),
  ('business_message', 'established', 60,      5),
  ('business_message', 'established', 86400,   50),
  -- invitations (friends only)
  ('invitation',       'new',         86400,   20),
  ('invitation',       'established', 86400,   50),
  -- reports
  ('report',           'new',         86400,   10),
  ('report',           'established', 86400,   10),
  ('urgent_report',    'new',         86400,   30),
  ('urgent_report',    'established', 86400,   30),
  -- business requests (unsolicited: same at both levels; the 10-minute duplicate check stays)
  ('business_request', 'new',         86400,   10),
  ('business_request', 'established', 86400,   10),
  -- commercial posts (unsolicited: same at both levels)
  ('commercial_post',  'new',         86400,   3),
  ('commercial_post',  'new',         604800,  10),
  ('commercial_post',  'established', 86400,   3),
  ('commercial_post',  'established', 604800,  10),
  -- profile changes after the first name / main photo
  ('name_change',      'new',         2592000, 2),
  ('name_change',      'established', 2592000, 3),
  ('photo_change',     'new',         86400,   15),
  ('photo_change',     'established', 86400,   20)
on conflict (action, trust_level, window_seconds) do update set max_count = excluded.max_count;

update private.account_signal_settings
   set duplicate_photo_min_accounts = 3, similar_name_min_similarity = 0.5, updated_at = now()
 where id;

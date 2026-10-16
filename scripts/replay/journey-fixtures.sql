-- Synthetic actors for running src/journeys/ against the from-scratch replay database ONLY (never production).
-- The journeys pick existing profiles / a business owner / an accepted friendship from the database they run on;
-- an empty replay has none. Six people, one group-only Food & Drink business (owned by the first), one accepted
-- friendship (people 2 + 3).
insert into auth.users (id, email, aud, role, created_at)
select ('00000000-0000-4000-8000-00000000000' || i)::uuid, 'replay' || i || '@example.invalid', 'authenticated', 'authenticated',
       now() - make_interval(days => 10 - i)
from generate_series(1, 6) i;
-- verified + visible (the profile read policy) and a push token (the senders' recipients), like real signed-up people
insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden, expo_push_token)
select ('00000000-0000-4000-8000-00000000000' || i)::uuid, 'Replay Person ' || i, date '1994-05-01', now() - make_interval(days => 10 - i),
       now(), 'America/New_York', true, false, 'ExponentPushToken[replay-' || i || ']'
from generate_series(1, 6) i;
insert into brand_partners (id, name, active, latitude, longitude, address, category, categories, max_group_size)
values ('00000000-0000-4000-8000-0000000000b1', 'Replay Test Cafe', true, 26.3587, -80.0831, '1 Test St, Boca Raton, FL',
        'food_drink', '{}', 40);
update profiles set managed_partner_id = '00000000-0000-4000-8000-0000000000b1' where id = '00000000-0000-4000-8000-000000000001';
insert into friendships (user_a, user_b, status, requested_by)
values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'accepted', '00000000-0000-4000-8000-000000000002');
-- one business request (planMessagePush attaches its plan to any existing one; production always has some)
insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category)
values ('00000000-0000-4000-8000-000000000004', 'replay fixture request', 26.36, -80.08, now() + interval '30 days', 2, 'Coffee');

-- Read-only. expected: t for the first three, f for the rest.
select t, public._title_safe_for_business(t) as safe from (values
 ('Coffee to see if Allen business picks it up'), ('Sarah''s Birthday brunch'), ('Yoga in the Park'),
 ('call me 555-123-4567'), ('visit www.example.com'), ('book at spot.com'), ('mail me a@b.co'),
 ('fuck this'), ('sex party'), (''), (repeat('a', 121))
) v(t);

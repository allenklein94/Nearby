-- The canonical path's own impact preview (_taxonomy_impact: STABLE, read-only) for every tag move and retirement in the
-- pass. Moves into the new Sports & Fitness group report the blocker "Unknown category group" until the group exists.
-- Stay & Getaway tags are previewed into travel_experiences (the recommended surviving key for Travel & Getaways; see the
-- prep doc's decision D2).
with plan(action, tag, new_group, keep_existing) as (values
  ('move','Fitness','sports_fitness',null::boolean),('move','Gyms','sports_fitness',null),('move','Yoga','sports_fitness',null),
  ('move','Pilates','sports_fitness',null),('move','Cycling','sports_fitness',null),('move','Running','sports_fitness',null),
  ('move','Martial Arts','sports_fitness',null),('move','Climbing','sports_fitness',null),('move','Skating','sports_fitness',null),
  ('move','Sports','sports_fitness',null),('move','Pickleball','sports_fitness',null),('move','Padel','sports_fitness',null),
  ('move','Tennis','sports_fitness',null),('move','Basketball','sports_fitness',null),('move','Soccer','sports_fitness',null),
  ('move','Volleyball','sports_fitness',null),('move','Golf','sports_fitness',null),('move','Swimming','sports_fitness',null),
  ('move','Boating','outdoors_nature',null),('move','Water Sports','outdoors_nature',null),
  ('move','Family Resorts','travel_experiences',null),('move','Glamping','travel_experiences',null),('move','Hotels','travel_experiences',null),
  ('move','Resorts','travel_experiences',null),('move','Road Trip','travel_experiences',null),('move','Romantic Getaways','travel_experiences',null),
  ('move','Spa Resorts','travel_experiences',null),('move','Staycation','travel_experiences',null),('move','Vacation Rentals','travel_experiences',null),
  ('move','Weekend Getaway','travel_experiences',null),
  ('retire','Pet Friendly Places',null,true),('retire','Pet Friendly Stays',null,true)
)
select p.action, p.tag, p.new_group,
  _taxonomy_impact(p.action, g.id, null, p.new_group, null, coalesce(p.keep_existing,false)) as impact
from plan p join category_tag_groups g on g.tag = p.tag;

-- Every CHECK constraint whose definition names a group key that the pass renames, splits or merges.
select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
from pg_constraint
where contype = 'c' and connamespace = 'public'::regnamespace
  and pg_get_constraintdef(oid) ~ '(activities_recreation|travel_experiences|stay_getaway|arts_culture_learning|food_drink|pets)'
order by 1, 2;

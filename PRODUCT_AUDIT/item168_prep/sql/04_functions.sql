-- Every function whose body names an affected group key, a moving/retiring tag, or the need lists.
select p.oid::regprocedure::text as fn,
  array_remove(array[
    case when prosrc ~ 'activities_recreation' then 'activities_recreation' end,
    case when prosrc ~ 'travel_experiences' then 'travel_experiences' end,
    case when prosrc ~ 'stay_getaway' then 'stay_getaway' end,
    case when prosrc ~ 'arts_culture_learning' then 'arts_culture_learning' end,
    case when prosrc ~ 'outdoors_nature' then 'outdoors_nature' end,
    case when prosrc ~* 'Pet Friendly' then 'Pet Friendly*' end,
    case when prosrc ~ '(''Boating''|''Water Sports''|''Gyms''|''Yoga''|''Climbing''|''Skating'')' then 'moving-tag literal' end,
    case when prosrc ~* 'business_only' then 'business_only' end,
    case when prosrc ~* 'dating_social' then 'dating_social' end
  ], null) as hits
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and prosrc ~* '(activities_recreation|travel_experiences|stay_getaway|arts_culture_learning|outdoors_nature|Pet Friendly|''Boating''|''Water Sports''|''Gyms''|''Yoga''|''Climbing''|''Skating''|business_only|dating_social)'
order by 1;

-- Every canonical tag row (live + retired), with its group and flags.
select id, key, tag, group_key, business_only, retired_at is not null as retired, replaced_by
from category_tag_groups order by group_key, id;

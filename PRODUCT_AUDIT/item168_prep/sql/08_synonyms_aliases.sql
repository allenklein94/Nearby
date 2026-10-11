-- The live wording layer: every synonym row (phrase -> tag, with the tag's group) and every remembered signup alias.
select 'synonym' as kind, s.phrase, s.tag, g.group_key, null::text as alias_category from category_synonyms s left join category_tag_groups g on g.tag = s.tag
union all
select 'alias', a.phrase, a.subcategory, null, a.category from category_aliases a
order by 1, 2, 3;

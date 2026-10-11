-- Registered columns that hold tag names or group keys (the canonical path's own registry).
select * from category_tag_references order by kind, table_name, column_name;

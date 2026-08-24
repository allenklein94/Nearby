-- Category/filter taxonomy pass (see CLAUDE.md "Category/filter taxonomy
-- pass" section) -- two new, purely optional, host-declared fields on
-- gatherings, both null by default (matching this schema's own
-- established "null means honestly unknown, never a guessed value"
-- convention -- zero behavior change for every existing row).
--
-- price_level: a real Free/$/$$/$$$ signal, backing the new "Price"
-- filter -- gatherings previously had no cost concept at all, so a price
-- filter with nothing behind it would have been fake. Mirrors the visual
-- convention Google Places' own priceLevelLabel() already established
-- elsewhere in this app, without reusing that function directly -- it
-- expects a Google 0-4 integer, this is a genuinely different, host-
-- declared enum shape.
--
-- party_type: "who this gathering is best for" (solo/friends/groups/
-- date), backing the new "People" filter -- deliberately a real,
-- separate, host-declared field, not derived/guessed from group_size_feel
-- or capacity (both measure something different -- a felt vibe, and a
-- hard cap -- and fabricating a Solo/Friends/Groups/Date label from
-- either would misrepresent real data).

alter table public.gatherings
  add column if not exists price_level text,
  add column if not exists party_type text;

-- A distinct dollar-quote tag (not the bare $$ default) is required here --
-- the price_level values themselves contain literal "$$"/"$$$" text, which
-- would otherwise prematurely terminate a bare $$ ... $$ block (dollar
-- quoting matches the end tag as raw text, with no awareness of nested
-- single-quoted string literals inside it).
do $migration$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gatherings_price_level_check'
  ) then
    alter table public.gatherings
      add constraint gatherings_price_level_check
      check (price_level is null or price_level in ('free', '$', '$$', '$$$'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'gatherings_party_type_check'
  ) then
    alter table public.gatherings
      add constraint gatherings_party_type_check
      check (party_type is null or party_type in ('solo', 'friends', 'groups', 'date'));
  end if;
end $migration$;

-- Remember which days the channel was told nothing shipped.
--
-- The schedule is two UTC cron entries for one 07:00 in Los Angeles, and the
-- guard in .github/workflows/daily.yml only turns away a run that is too early,
-- so a delayed morning can put both entries through on the same day. Every
-- other thing a run posts is deduped by the item behind it; the empty-day line
-- has no item, so it had nothing to dedupe against and went out twice.
--
--   psql "$DATABASE_URL" -f migrations/004_quiet_days.sql
--
-- One row per day rather than one mutable row, because the history answers the
-- question anyone asks of this table: which mornings did the channel hear that
-- nothing had shipped?
create table if not exists quiet_days (
  -- The calendar day in America/Los_Angeles, which is the day the cron is set
  -- in. A UTC day would split a Pacific morning across two rows in winter.
  day       date        primary key,
  posted_at timestamptz not null default now()
);

-- Same reasoning as 002_close_data_api.sql: row-level security with no policy
-- denies every row to the two roles PostgREST authenticates as, and the bot
-- connects as `postgres`, which bypasses it.
alter table quiet_days enable row level security;

-- 002 revoked the default privileges that granted these roles anything new in
-- `public`, so this is belt and braces on a database that ran 002 and the whole
-- fix on one that has not. Guarded because a local Postgres has neither role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table quiet_days from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table quiet_days from authenticated;
  end if;
end $$;

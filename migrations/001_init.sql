-- Reference copy of the schema the app expects. It is already applied to the
-- Supabase project, so this file exists for local Postgres and for review.

create table if not exists items (
  id            bigserial primary key,
  competitor    text        not null,
  source        text        not null,
  external_id   text        not null,
  title         text        not null,
  url           text        not null,
  published_at  timestamptz,
  raw           jsonb       not null default '{}'::jsonb,
  seen_at       timestamptz not null default now(),
  unique (competitor, source, external_id)
);

create index if not exists items_competitor_source_seen_idx
  on items (competitor, source, seen_at desc);

create table if not exists analyses (
  id              bigserial primary key,
  item_id         bigint      not null references items (id) on delete cascade,
  severity        text        not null,
  analysis        jsonb       not null,
  slack_posted_at timestamptz,
  model           text        not null,
  created_at      timestamptz not null default now()
);

create index if not exists analyses_item_idx on analyses (item_id);

create table if not exists pages (
  url        text primary key,
  title      text,
  text       text,
  mentions   text[]      not null default '{}',
  fetched_at timestamptz not null default now()
);

create index if not exists pages_mentions_idx on pages using gin (mentions);

create table if not exists claims (
  id         bigserial primary key,
  url        text not null references pages (url) on delete cascade,
  competitor text not null,
  paragraph  text not null,
  heading    text
);

create index if not exists claims_competitor_idx on claims (competitor);
create index if not exists claims_url_idx on claims (url);

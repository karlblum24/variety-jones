-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Players
create table if not exists players (
  id              uuid primary key default gen_random_uuid(),
  discord_id      text unique not null,
  discord_username text not null,
  created_at      timestamptz default now()
);

-- Picks
create table if not exists picks (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references players(id) on delete cascade,
  week_number     integer not null,
  season_year     integer not null,
  game_id         text not null,
  team_picked     text not null,
  pick_type       text not null check (pick_type in ('moneyline', 'spread')),
  odds_at_lock    integer,
  spread_point    decimal(4,1),
  game_start_time timestamptz,
  result          text check (result in ('win', 'loss', 'push')),
  points_awarded  decimal(6, 2),
  -- MIGRATION: add this column manually in Supabase:
  -- ALTER TABLE picks ADD COLUMN cancelled BOOLEAN NOT NULL DEFAULT FALSE;
  cancelled       boolean not null default false,
  created_at      timestamptz default now()
);

-- Weekly Scores
create table if not exists weekly_scores (
  id               uuid primary key default gen_random_uuid(),
  player_id        uuid not null references players(id) on delete cascade,
  week_number      integer not null,
  season_year      integer not null,
  total_points     decimal(8, 2) not null default 0,
  picks_submitted  integer not null default 0,
  updated_at       timestamptz default now(),
  unique (player_id, week_number, season_year)
);

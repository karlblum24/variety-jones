-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Players
create table if not exists players (
  id              uuid primary key default gen_random_uuid(),
  discord_id      text unique not null,
  discord_username text not null,
  has_paid        boolean not null default false,
  display_name    text,
  venmo_handle    text,
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
  home_team       text,
  away_team       text,
  game_start_time timestamptz,
  result          text check (result in ('win', 'loss', 'push', 'void')),
  points_awarded  decimal(6, 2),
  notified        boolean not null default false,
  cancelled       boolean not null default false,
  created_at      timestamptz default now()
);


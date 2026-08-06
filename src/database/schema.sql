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

-- Aggregates. These exist so standings are summed in Postgres rather than in
-- Node: PostgREST caps every response at 1000 rows, so any query that pulled
-- all graded picks and summed them client-side silently froze once the league
-- crossed 1000 graded picks. Each view returns one row per player, so it stays
-- far under the cap.

create or replace view player_season_totals as
select player_id, season_year, sum(points_awarded) as season_points
from picks
where result is not null and cancelled = false
group by player_id, season_year;

create or replace view player_week_totals as
select player_id, season_year, week_number, sum(points_awarded) as week_points
from picks
where result is not null and cancelled = false
group by player_id, season_year, week_number;

-- Points per player within an arbitrary game_start_time window, used for the
-- first/second half champion. Pass '1970-01-01' as cutoff_start for the first
-- half (the halves are split on HALF_CUTOFF in src/services/picks.js).
create or replace function get_half_totals(cutoff_start timestamptz, cutoff_end timestamptz)
returns table (player_id uuid, total_points numeric)
language sql stable as $$
  select p.player_id, sum(p.points_awarded)
  from picks p
  where p.result is not null and p.cancelled = false
    and p.game_start_time >= cutoff_start and p.game_start_time < cutoff_end
  group by p.player_id
$$;


# 2026 PICKS LEAGUE — SUBMISSION SLAVE

A Discord bot for a private baseball picks league. Players DM the bot
to submit weekly picks on MLB games. Results are graded automatically,
scores are tracked in Supabase, and a daily AI-generated recap is posted
every morning.

## Tech Stack

- **Node.js** — runtime
- **discord.js v14** — Discord bot framework
- **Supabase** — Postgres database for players and picks
- **The Odds API** — fetches live MLB moneyline and spread odds (10-minute in-memory cache)
- **MLB Stats API** — fetches game results for grading
- **Anthropic Claude API** — generates daily AI recap messages
- **node-cron** — schedules daily grading, scoreboard, recap, and reminder jobs
- **Railway** — hosting and auto-deploy on push to dev branch

## Environment Variables

Copy `.env.example` to `.env` and fill in each value:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from the Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application (client) ID from the Discord Developer Portal |
| `ODDS_API_KEY` | API key from The Odds API |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `ANTHROPIC_KEY` | Anthropic API key for daily recap generation |
| `SCOREBOARD_CHANNEL_ID` | Discord channel ID for scoreboard posts |
| `GENERAL_CHANNEL_ID` | Discord channel ID for daily recap posts |
| `ADMIN_DISCORD_ID` | Discord user ID of the admin |
| `IS_PRESEASON` | Set to `true` to enable preseason mode (unlimited picks) |

## Running Locally
```bash
npm install
cp .env.example .env
# fill in .env values
npm start
```

To register slash commands with Discord:
```bash
npm run deploy
```

## Deploying

Push to the `dev` branch. Railway auto-deploys on every push.

## Project Structure

```
src/
├── commands/
│   ├── ping.js                  # /ping — health check
│   └── postrules.js             # /postrules — posts league rules embed
├── config/
│   └── scoring.js               # Point tiers by odds range, getPointsForResult()
├── database/
│   ├── schema.sql               # Supabase table definitions
│   └── supabase.js              # Supabase client singleton
├── handlers/
│   ├── adminHandler.js          # Admin DM commands (see Admin Commands section)
│   ├── dailyRecap.js            # Daily 9:00 AM ET cron — AI recap posted to #general
│   ├── dmHandler.js             # DM pick flow — onboarding, slate, parsing, confirm, cancel, show picks
│   ├── gameStartNotifier.js     # Polls every 60s, DMs players when their game starts
│   ├── grader.js                # Daily 6:00 AM + 12:00 PM ET cron — grades picks via MLB Stats API
│   ├── scoreboard.js            # Daily 6:05 AM ET cron — posts standings embed to #scoreboard
│   └── weeklyReminder.js        # Saturday + Sunday 10:00 AM ET — DMs players with picks remaining
├── services/
│   ├── oddsApi.js               # Fetches MLB game odds with 10-minute in-memory cache
│   └── picks.js                 # Supabase helpers: player lookup, pick queries, submit, cancel
├── utils/
│   └── logger.js                # Structured JSON logger (info, error)
├── deploy-commands.js           # Registers slash commands globally with Discord
└── index.js                     # Bot entrypoint — wires all handlers, starts client, handles crashes
```

## Key Behaviors

### New User Onboarding
When a player joins the server or first DMs the bot, they are walked
through an onboarding flow collecting their real name and Venmo handle
before they can make picks. Existing users missing these fields are
prompted to complete onboarding on next DM. Sessions time out after
3 minutes and restart cleanly.

### DM Pick Flow
Players DM the bot to submit picks. The bot shows the current game slate
with live odds, grouped by TODAY and TOMORROW with clear date headers.
Games are numbered. Players type picks in free-form:

- `Yankees ml` — picks Yankees in their next upcoming game
- `Yankees ml 4` — picks Yankees specifically in game 4
- `Braves spread, Cubs ml` — multiple picks comma-separated

The bot shows a confirmation with locked odds and point values. Player
replies YES to confirm. Sessions expire after 3 minutes of inactivity.

### Pick Rules
- 3 picks per week (Monday–Sunday). Unused picks don't roll over.
- Each team can only be picked once per week. Each game can only be picked once per week.
- Cancelling a pick returns the pick slot and frees the team — but burns
  the game slot for the week (cannot re-pick the same game).
- Voided picks (postponed/cancelled games) return both the slot and the
  game — player can re-pick freely.

### Odds Locking
Odds are locked at submission time. `odds_at_lock`, `spread_point`,
`home_team`, and `away_team` are all written to the pick record on insert.

### Spread Grading
Spread picks are graded using stored `spread_point`. Covers if
`(pickedScore - opposingScore) > -spreadPoint`. Exact ties = push.

### Team Matching
Pick submission uses priority-ordered matching: exact → contains →
word-level. Grader uses dual-team matching (home + away stored at
submission), eliminating ambiguous fuzzy matching (Sox vs Red Sox).
Old picks without stored team names fall back to single-team matching.

### Game Start Notifier
Runs every 60 seconds. Finds picks where game has started and
`notified = false`. DMs player with locked point opportunity.
Marks `notified = true` in DB to prevent duplicate DMs on restart.
Marks notified on DM failure to prevent infinite retry loops.

### Daily Grader (6:00 AM + 12:00 PM ET)
Primary run at 6am, catch-up at noon for late-finishing games. Queries
all ungraded non-cancelled picks where game time has passed. Tries
regular season (R) first then spring training (S). Matches game using
stored home/away team names. Uses ET date (not UTC) to prevent
late-night game lookup errors.

Terminal states: Final, Completed Early, Game Over.
Void states: Cancelled, Postponed, Suspended (startsWith to catch variants).

Voided picks: result = void, points = 0, player DM'd, game slot returned.
Stale picks (18+ hours ungraded): admin DM alert.
Fatal errors: admin DM alert immediately.

### Scoreboard (6:05 AM ET)
Posts embed to #scoreboard with season totals, this week's points, and
picks remaining. Includes Longest Shot Award (split at July 14).
Cron only — does not post on bot startup.

### Daily AI Recap (9:00 AM ET)
Queries yesterday's graded picks and standings. Sends to Claude API
(claude-haiku) with SUBMISSION SLAVE personality prompt. Pings all
players via Discord mention. Posted to #general. Chunked for 2000-char
limit. Skips if no picks graded yesterday. Personality overridable via
`RECAP_PERSONALITY` env var.

### Daily Signup Reminder (10:00 AM ET)
Posts to #general listing server members who haven't DMed the bot yet.
Pings everyone in the server and asks them to reach out to unregistered
members. Skips silently if all members are registered. Triggerable
manually with `!admin signupreminder`.

### Weekly Reminder (Saturday + Sunday 10:00 AM ET)
DMs players who still have picks remaining. Skips in preseason mode.

### Show My Picks
User types "my picks" or similar. Returns four sections: Pending,
Locked, Completed, Voided. Shows picks remaining for the week.

### Cancel a Pick
User types "cancel". Shows pending picks. User selects by number,
confirms YES. Slot returned, team freed, game burned for the week.

### Admin Commands

| Command | Action |
|---|---|
| `!admin scoreboard` | Post scoreboard now |
| `!admin recap` | Post daily recap now |
| `!admin grade` | Run grader now |
| `!admin remind` | Send weekly reminders |
| `!admin signupreminder` | Post signup reminder to #general |
| `!admin scan` | Compare server members vs DB — find gaps |
| `!admin hypeup` | DM all paid players with Opening Day hype |
| `!admin chasepayment` | DM all unpaid players to submit entry fee |
| `!admin paid <username>` | Mark player as paid |
| `!admin unpaid <username>` | Mark player as unpaid |
| `!admin players` | List all players with name, Venmo, paid status |
| `!admin clearcache` | Force fresh odds fetch from API |

### Crash Prevention
`unhandledRejection` and `uncaughtException` handled in index.js to
log without crashing.

### Odds API Caching
Slate cached 10 minutes in memory. Use `!admin clearcache` to force
fresh fetch. Game numbers in a session are stable even if cache
refreshes — `conversationState` holds the session's games snapshot.

## Scoring

| Odds Range | Win | Loss |
|---|---|---|
| ≤ -250 | +0.5 | -0.5 |
| -249 to -200 | +1.0 | -0.5 |
| -199 to -150 | +1.5 | 0 |
| -149 to +100 | +2.0 | 0 |
| +101 to +150 | +2.5 | 0 |
| +151 to +199 | +3.0 | 0 |
| +200 to +299 | +3.5 | 0 |
| ≥ +300 | +4.0 | 0 |

## Slash Commands

| Command | Description |
|---|---|
| `/ping` | Check if the bot is online |
| `/postrules` | Post the league rules embed |

## Database Schema (Supabase)

**players:** id, discord_id, discord_username, display_name, venmo_handle, has_paid, created_at

**picks:** id, player_id, week_number, season_year, game_id, team_picked, pick_type, odds_at_lock, spread_point, home_team, away_team, game_start_time, result (win/loss/push/void), points_awarded, notified, cancelled, created_at

No weekly_scores table — all scoring aggregates directly from picks.

## Preseason Mode

When `IS_PRESEASON=true`, the weekly pick cap is removed, the scoreboard
shows "unlimited" picks remaining, the game list shows a preseason
banner, and weekly reminders are skipped. Set to false before Opening
Day. Wipe preseason picks from Supabase before flipping the flag.

## Before Opening Day Checklist

- [ ] Set `IS_PRESEASON=false` in Railway
- [ ] Confirm all players have paid (`!admin players` to audit)
- [ ] Run `!admin paid <username>` for each confirmed payment
- [ ] Wipe preseason picks from Supabase
- [ ] Confirm `SCOREBOARD_CHANNEL_ID` and `GENERAL_CHANNEL_ID` are correct
- [ ] Test `!admin grade`, `!admin scoreboard`, `!admin recap`
- [ ] Confirm Railway is on Hobby plan ($5/month)

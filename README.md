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
3 minutes of inactivity and restart cleanly.

### DM Pick Flow
Players DM the bot to submit picks. The bot shows the current game slate
with live moneyline and spread odds (cached for 10 minutes to protect
API quota). Players type picks in free-form: `Yankees ml`,
`Braves spread, Cubs ml`. Multiple picks can be submitted in one message,
comma-separated. The bot shows a confirmation summary with locked odds and point
values. The player replies YES to confirm. Sessions expire after 3
minutes of inactivity. Games with no available odds are filtered out
of the slate automatically.

### Odds Locking
Odds are locked at submission time — not at game start. `odds_at_lock`,
`spread_point`, `home_team`, and `away_team` are all written to the pick
record on insert.

### Spread Grading
Spread picks are graded using the stored `spread_point` value. A pick
covers if `(pickedScore - opposingScore) > -spreadPoint`. Exact ties
grade as push (0 pts). Picks missing `spread_point` fall back to
outright win/loss.

### Team Matching
Pick submission uses priority-ordered team name matching: exact match
first, then full name contains, then word-level matching. The grader
uses dual-team matching (home + away) stored at submission time,
eliminating ambiguous single-team fuzzy matching (e.g. Sox vs Red Sox).
Old picks without stored team names fall back to single-team matching.

### Game Start Notifier
Runs every 60 seconds. Finds picks where the game has started and
`notified = false`. DMs the player with locked odds and point
opportunity. Marks `notified = true` in the DB — persists across
restarts to prevent duplicate DMs. On DM failure, marks notified
anyway to prevent infinite retry loops.

### Daily Grader (6:00 AM + 12:00 PM ET)
Primary run at 6am, catch-up run at noon to catch late-finishing games.
Queries all ungraded, non-cancelled picks where game time has passed.
For each pick: fetches final score from MLB Stats API (tries spring
training gameType=S first, then regular season R), matches game using
stored home/away team names, determines result, calculates points, and
updates the pick. Terminal states: Final, Completed Early, Game Over.
Void states: Cancelled, Postponed, Suspended (and variants via
startsWith). Voided picks return the game slot to the player, DM the
player with an explanation, and award 0 points. Stale picks (ungraded
18+ hours after game start) trigger an admin DM alert. Fatal grader
errors DM the admin immediately.

### Scoreboard (6:05 AM ET)
Posts a Discord embed to #scoreboard with season totals, this week's
points, and picks remaining per player. Includes a Longest Shot Award
tracking the highest-odds winning pick by half-season (split at
July 14). Posts on cron schedule only — not on bot startup.

### Daily AI Recap (9:00 AM ET)
Queries yesterday's graded picks and current standings. Builds a
structured data payload and sends it to the Claude API (claude-haiku)
to generate a snarky, in-character recap as SUBMISSION SLAVE. Uses
Discord mention syntax (<@USER_ID>) to ping players by name. Posted
to #general. Chunked to respect Discord's 2000-character limit. Skips
silently if no picks were graded yesterday.

### Weekly Reminder (Saturday + Sunday 10:00 AM ET)
DMs every player who still has picks remaining for the week. Skips
automatically in preseason mode. Can be triggered manually with
`!admin remind`.

### Show My Picks
User types "my picks" or similar. Bot responds with four sections:
Pending (game hasn't started), Locked (game in progress, no result),
Completed (graded), and Voided (postponed/cancelled games). Shows
picks remaining for the week.

### Cancel a Pick
User types "cancel" or similar. Bot shows pending picks (games not
yet started). User selects by number and confirms YES. Pick marked
`cancelled = true`, slot returned — but the game cannot be picked
again that week. Voided picks (postponed/cancelled games) return the
slot automatically and allow re-picking.

### Admin Commands
Only works for the Discord user matching `ADMIN_DISCORD_ID`. Admin
messages stop processing before reaching the DM pick flow.

| Command | Action |
|---|---|
| `!admin scoreboard` | Post scoreboard to #scoreboard now |
| `!admin recap` | Post daily recap to #general now |
| `!admin grade` | Run the grader now |
| `!admin remind` | Send weekly reminders to players with picks remaining |
| `!admin paid <username>` | Mark a player as paid in Supabase |
| `!admin unpaid <username>` | Mark a player as unpaid in Supabase |
| `!admin players` | List all players with name, Venmo, and payment status |
| `!admin clearcache` | Force fresh odds fetch from API |

### Crash Prevention
`process.on('unhandledRejection')` and `process.on('uncaughtException')`
are handled in index.js to log errors without crashing the process.

### Odds API Caching
Game slate is cached in memory for 10 minutes. All DMs within that
window share one API call. Use `!admin clearcache` to force a fresh
fetch if needed (e.g. if odds change significantly before a game).

## Scoring

Points are awarded based on American odds at submission time:

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
| `/postrules` | Post the league rules embed to the current channel |

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

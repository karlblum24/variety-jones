# 2026 PICKS LEAGUE — SUBMISSION SLAVE

A Discord bot for a private baseball picks league. Players DM the bot
to submit weekly picks on MLB games. Results are graded automatically,
scores are tracked in Supabase, and a daily AI-generated recap is posted
every morning.

## Tech Stack

- **Node.js** — runtime
- **discord.js v14** — Discord bot framework
- **Supabase** — Postgres database for players and picks
- **The Odds API** — fetches live MLB moneyline and spread odds
- **MLB Stats API** — fetches game results for grading
- **Anthropic Claude API** — generates daily AI recap messages
- **node-cron** — schedules daily grading, scoreboard, and recap jobs
- **Railway** — hosting and auto-deploy on push to dev branch

## Environment Variables

Copy `.env.example` to `.env` and fill in each value:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` |  Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application (client) ID from the Discord Developer Portal |
| `ODDS_API_KEY` | API key from The Odds API |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `ANTHROPIC_KEY` | Anthropic API key for daily recap generation |
| `SCOREBOARD_CHANNEL_ID` | Discord channel ID for scoreboard posts |
| `GENERAL_CHANNEL_ID` | Discord channel ID for daily recap posts |
| `ADMIN_DISCORD_ID` | Discord user ID of the admin (you) |
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
│   ├── adminHandler.js          # Admin DM commands (!admin grade/scoreboard/recap/paid/unpaid)
│   ├── dailyRecap.js            # Daily 9:00 AM ET cron — AI-generated recap posted to #general
│   ├── dmHandler.js             # DM pick flow — onboarding, game slate, pick parsing, confirmation, cancel, show picks
│   ├── gameStartNotifier.js     # Polls every 60s, DMs players when their game starts
│   └── grader.js                # Daily 5:00 AM ET cron — grades completed picks via MLB Stats API
├── services/
│   ├── oddsApi.js               # Fetches upcoming MLB + preseason odds from The Odds API
│   └── picks.js                 # Supabase helpers: player lookup, pick queries, submit, cancel
├── utils/
│   └── logger.js                # Structured JSON logger (info, error)
├── deploy-commands.js           # Registers slash commands globally with Discord
└── index.js                     # Bot entrypoint — wires all handlers, starts client, handles crashes
```

## Key Behaviors

### New User Onboarding
When a player first DMs the bot or joins the server, they are walked
through an onboarding flow that collects their real name and Venmo handle
before they can make picks. This data is stored in Supabase and used for
payout coordination at the end of the season.

### DM Pick Flow
Players DM the bot to submit picks. The bot shows the current game slate
with moneyline and spread odds. Players type picks in free-form:
`Yankees ml`, `Braves spread, Cubs ml`. Multiple picks can be submitted
in one message, comma-separated. The bot shows a confirmation summary
with locked odds and point values. The player replies YES to confirm.
Sessions expire after 3 minutes of inactivity. Games with no available
odds are filtered out of the slate automatically.

### Odds Locking
Odds are locked at submission time. `odds_at_lock` and `spread_point`
are written to the pick record on insert. Players see their locked odds
in the confirmation message and in game start DMs.

### Spread Grading
Spread picks are graded using the stored `spread_point` value. A pick
covers if `(pickedScore - opposingScore) > -spreadPoint`. Exact ties
are graded as a push. Picks missing a spread_point fall back to outright
win/loss grading.

### Game Start Notifier
Runs every 60 seconds. Finds picks where the game has started and
`notified = false`. DMs the player with their locked odds and point
opportunity. Marks `notified = true` after sending — persisted to DB
so restarts don't cause duplicate DMs. Marks notified on failure too
to prevent infinite retry loops.

### Daily Grader (5:00 AM ET)
Queries all ungraded picks where game time has passed. For each pick,
fetches the final score from the MLB Stats API, fuzzy-matches the team
by name (tries spring training gameType=S first, then regular season R),
determines win/loss/push, calculates points based on locked odds, and
updates the pick in Supabase. Alerts the admin via DM if the grader
throws a fatal error.

### Scoreboard (5:05 AM ET)
Posts a Discord embed to #scoreboard with season totals, this week's
points, and picks remaining per player. Includes a Longest Shot Award
tracking the highest-odds winning pick by half-season (split at July 14).
Posts on cron schedule only — not on bot startup.

### Daily AI Recap (9:00 AM ET)
Queries yesterday's graded picks and current standings. Builds a
structured data payload and sends it to the Claude API (claude-haiku)
to generate a snarky, in-character recap message as SUBMISSION SLAVE.
Posted to #general. Chunked to respect Discord's 2000-character limit.
Skips silently if no picks were graded yesterday.

### Show My Picks
User types "my picks" or similar at any time. Bot responds with three
sections — Pending (game hasn't started), Locked (game in progress),
Completed — plus picks remaining for the week.

### Cancel a Pick
User types "cancel" or similar. Bot shows pending picks. User selects
one by number and confirms with YES. Pick is marked cancelled = true,
slot is returned — but the game cannot be picked again that week.

### Admin Commands
Only works for the Discord user matching ADMIN_DISCORD_ID. Triggers
stop the message from being processed by the DM pick flow.

| Command | Action |
|---|---|
| `!admin scoreboard` | Post scoreboard to #scoreboard now |
| `!admin recap` | Post daily recap to #general now |
| `!admin grade` | Run the grader now |
| `!admin paid <username>` | Mark a player as paid in Supabase |
| `!admin unpaid <username>` | Mark a player as unpaid in Supabase |

### Crash Prevention
`process.on('unhandledRejection')` and `process.on('uncaughtException')`
are handled in index.js to prevent Railway from restarting the bot on
non-fatal errors.

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
shows "unlimited" picks remaining, and the game list shows a preseason
banner. Set to false before Opening Day. Wipe preseason picks from
Supabase before flipping the flag.

## Before Opening Day Checklist

- [ ] Set IS_PRESEASON=false in Railway
- [ ] Confirm all players have paid (!admin paid <username>)
- [ ] Wipe preseason picks from Supabase
- [ ] Confirm SCOREBOARD_CHANNEL_ID and GENERAL_CHANNEL_ID are correct
- [ ] Test !admin grade, !admin scoreboard, !admin recap

# Variety Jones

A Discord bot for a private baseball picks league. Players DM the bot to submit weekly picks on MLB games. Results are graded automatically, scores are tracked in Supabase, and a scoreboard is posted daily.

## Tech Stack

- **Node.js** — runtime
- **discord.js v14** — Discord bot framework
- **Supabase** — Postgres database for players, picks, and weekly scores
- **The Odds API** — fetches live MLB moneyline and spread odds
- **MLB Stats API** — fetches game results for grading
- **node-cron** — schedules daily grading and scoreboard jobs
- **Railway** — hosting and auto-deploy

## Environment Variables

Copy `.env.example` to `.env` and fill in each value:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from the Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application (client) ID from the Discord Developer Portal |
| `ODDS_API_KEY` | API key from The Odds API |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `IS_PRESEASON` | Set to `true` to enable preseason mode (unlimited picks, no weekly cap) |

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

Push to the `dev` branch. Railway is connected to the repo and auto-deploys on push.

## Project Structure

```
src/
├── commands/
│   ├── ping.js                  # /ping — health check
│   └── postrules.js             # /postrules — posts league rules embed
├── config/
│   └── scoring.js               # Point tiers by odds range, getPointsForResult()
├── database/
│   ├── schema.sql               # Supabase table definitions (players, picks, weekly_scores)
│   └── supabase.js              # Supabase client singleton
├── handlers/
│   ├── dmHandler.js             # DM-based pick submission flow (4-step conversation)
│   ├── gameStartNotifier.js     # Polls every 60s, locks closing odds and DMs players at game time
│   ├── grader.js                # Daily 5:00 AM ET cron — grades completed picks via MLB Stats API
│   └── scoreboard.js            # Daily 5:05 AM ET cron — posts standings embed to #scoreboard
├── services/
│   ├── oddsApi.js               # Fetches upcoming MLB + preseason odds from The Odds API
│   └── picks.js                 # Supabase helpers: getOrCreatePlayer, getPicksThisWeek, submitPick
├── deploy-commands.js           # Registers slash commands globally with Discord
└── index.js                     # Bot entrypoint — wires all handlers and starts the client
```

## Key Behaviors

### DM Pick Flow
Players DM the bot to submit picks. The bot walks them through a 4-step conversation:
1. Shows available upcoming games with odds
2. Player selects game(s) by number
3. Player selects team + pick type (moneyline or spread) — shorthand `ml`, `rl`, `runline` accepted
4. Player confirms with YES

Sessions expire after 30 seconds of inactivity. Duplicate game picks are blocked. Message deduplication prevents double-processing.

### Game Start Notifier
Runs every 60 seconds. Finds picks where the game has started but `odds_at_lock` is not yet set. Fetches the current closing line from The Odds API, saves it to the pick, and DMs the player with their locked odds and point opportunity.

### Daily Grader (5:00 AM ET)
Queries all picks where `result IS NULL` and `odds_at_lock IS NOT NULL` and game time has passed. For each pick, fetches the final score from the MLB Stats API, fuzzy-matches the game by team name and date (tries spring training `gameType=S` first, then regular season `gameType=R`), determines win/loss, calculates points, and updates the pick and weekly scores in Supabase.

### Scoreboard (5:05 AM ET)
Posts a Discord embed to `#scoreboard` with season totals, this week's points, and picks remaining per player. Includes a Longest Shot Award tracking the highest-odds winning pick by half-season (split at July 14). Also posts once on bot startup.

### Preseason Mode
When `IS_PRESEASON=true`, the weekly 3-pick cap is removed, the scoreboard shows "unlimited" picks remaining, and the game list shows a preseason banner. All preseason data is wiped before Opening Day.

## Slash Commands

| Command | Description |
|---|---|
| `/ping` | Check if the bot is online |
| `/postrules` | Post the league rules embed to the current channel |

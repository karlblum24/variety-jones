# Variety Jones — SUBMISSION SLAVE

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
│   ├── dmHandler.js             # DM pick flow — game slate, pick parsing, confirmation, cancel, show picks
│   ├── gameStartNotifier.js     # Polls every 60s, DMs players when their game starts
│   ├── grader.js                # Daily 5:00 AM ET cron — grades completed picks via MLB Stats API
│   └── scoreboard.js            # Daily 5:05 AM ET cron — posts standings embed to #scoreboard
├── services/
│   ├── oddsApi.js               # Fetches upcoming MLB + preseason odds from The Odds API
│   └── picks.js                 # Supabase helpers: player lookup, pick queries, submit, cancel
├── deploy-commands.js           # Registers slash commands globally with Discord
└── index.js                     # Bot entrypoint — wires all handlers and starts the client
```

## Key Behaviors

### DM Pick Flow
Players DM the bot to submit picks. The bot shows the current game slate with moneyline and spread odds. Players type picks in free-form: `Yankees ml`, `Braves spread, Cubs ml`. Multiple picks can be submitted in one message, comma-separated. The bot shows a confirmation summary and the player replies `YES` to confirm. Sessions expire after 3 minutes of inactivity.

### Odds Locking
Odds are locked at submission time, not at game start. `odds_at_lock` is written to the pick record on insert. Players can see their locked odds in the confirmation message and in game start DMs.

### Game Start Notifier
Runs every 60 seconds. Finds picks where the game has started and the player hasn't been notified yet. DMs the player with their locked odds and point opportunity for that game.

### Daily Grader (5:00 AM ET)
Queries all ungraded picks where the game time has passed. For each pick, fetches the final score from the MLB Stats API, fuzzy-matches the game by team name and date (tries spring training `gameType=S` first, then regular season `gameType=R`), determines win/loss/push, calculates points, and updates the pick and weekly scores in Supabase.

### Scoreboard (5:05 AM ET)
Posts a Discord embed to `#scoreboard` with season totals, this week's points, and picks remaining per player. Includes a Longest Shot Award tracking the highest-odds winning pick by half-season (split at July 14). Also posts once on bot startup.

### Preseason Mode
When `IS_PRESEASON=true`, the weekly pick cap is removed, the scoreboard shows "unlimited" picks remaining, and the game list shows a preseason banner. Intended for testing before Opening Day.

### Show My Picks
User types `my picks`, `picks`, `show my picks`, or `show picks` at any time (including mid-conversation). Bot responds with three sections — ⏳ Pending (game hasn't started), 🔒 Locked (game in progress, no result yet), ✅ Completed — plus picks remaining for the week.

### Cancel a Pick
User types `cancel`, `cancel pick`, `cancel my pick`, or `cancel a pick`. Bot shows a numbered list of pending picks (game hasn't started). User selects one and confirms with YES. The pick is marked `cancelled = true`, the pick slot is returned, but **the game cannot be picked again that week**.

### Discord 2000-Character Limit
Long messages (game slates, pick summaries) are split at logical boundaries into chunks under 1900 characters. The first chunk is sent as a reply; subsequent chunks are sent via `message.author.send()`.

## Slash Commands

| Command | Description |
|---|---|
| `/ping` | Check if the bot is online |
| `/postrules` | Post the league rules embed to the current channel |

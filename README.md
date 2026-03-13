# Variety Jones Discord Bot

A Discord bot built with [discord.js v14](https://discord.js.org/) using slash commands.

## Prerequisites

- Node.js 18+
- A Discord application with a bot token ([Discord Developer Portal](https://discord.com/developers/applications))

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from the Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application (client) ID from the Discord Developer Portal |
| `ODDS_API_KEY` | API key from [The Odds API](https://the-odds-api.com/) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon/public key |

### 3. Deploy slash commands

This registers commands globally with Discord (may take up to an hour to propagate):

```bash
npm run deploy
```

### 4. Run the bot

```bash
npm start
```

## Project Structure

```
src/
├── commands/          # One file per slash command
│   └── ping.js
├── deploy-commands.js # Registers slash commands with Discord
└── index.js           # Bot entrypoint
```

## Adding a New Command

1. Create a new file in `src/commands/`, e.g. `src/commands/hello.js`:

```js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hello')
    .setDescription('Say hello'),

  async execute(interaction) {
    await interaction.reply('Hello!');
  },
};
```

2. Re-run `npm run deploy` to register the new command.

## Available Commands

| Command | Description |
|---|---|
| `/ping` | Check if the bot is online |

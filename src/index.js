require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { handleDM } = require('./handlers/dmHandler');
const { startGameNotifier } = require('./handlers/gameStartNotifier');
const { startGrader } = require('./handlers/grader');
const { postScoreboard, startScoreboardScheduler } = require('./handlers/scoreboard');
const { startDailyRecap } = require('./handlers/dailyRecap');
const logger = require('./utils/logger');

process.on('unhandledRejection', (err) => logger.error('process', 'Unhandled rejection', err));
process.on('uncaughtException', (err) => { logger.error('process', 'Uncaught exception', err); });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  } else {
    logger.warn('index', `${file} is missing "data" or "execute"`);
  }
}

client.once('ready', () => {
  logger.info('index', `Logged in as ${client.user.tag}`);
  startGameNotifier(client);
  startGrader(client);
  startScoreboardScheduler(client);
  startDailyRecap(client);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.DM) return;
  try {
    await handleDM(message);
  } catch (err) {
    logger.error('index', 'handleDM threw', err);
    try { await message.reply('Something went wrong. Please try again.'); } catch (_) {}
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error('index', `Command "${interaction.commandName}" failed`, error);
    const reply = { content: 'An error occurred while executing that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

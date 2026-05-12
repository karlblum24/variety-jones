require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { handleDM } = require('./handlers/dmHandler');
const { startGameNotifier } = require('./handlers/gameStartNotifier');
const { startGrader } = require('./handlers/grader');
const { postScoreboard, startScoreboardScheduler } = require('./handlers/scoreboard');
const { startDailyRecap } = require('./handlers/dailyRecap');
const { handleAdminCommand } = require('./handlers/adminHandler');
const { startWeeklyReminder } = require('./handlers/weeklyReminder');
const { startSignupReminder } = require('./handlers/dailySignupReminder');
const logger = require('./utils/logger');

process.on('unhandledRejection', (err) => logger.error('process', 'Unhandled rejection', err));
process.on('uncaughtException', (err) => { logger.error('process', 'Uncaught exception', err); });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
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
    logger.error('index', `${file} is missing "data" or "execute"`, {});
  }
}

client.once('ready', () => {
  logger.info('index', `Logged in as ${client.user.tag}`);
  startGameNotifier(client);
  startGrader(client);
  startScoreboardScheduler(client);
  startDailyRecap(client);
  startWeeklyReminder(client);
  // startSignupReminder(client); // disabled
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const handledByAdmin = await handleAdminCommand(message, client);
  if (handledByAdmin) return;
  if (message.channel.type !== ChannelType.DM) return;
  try {
    await handleDM(message);
  } catch (err) {
    logger.error('index', 'handleDM threw', err);
    try { await message.reply('Something went wrong. Please try again.'); } catch (_) {}
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    await member.send(
      `👋 **Welcome to the 2026 PICKS LEAGUE, big shot!**\n\n` +
      `I'm SUBMISSION SLAVE, your picks league bot. Here's the deal:\n\n` +
      `• Each week you get **3 picks** on MLB games\n` +
      `• Pick a team **moneyline** (win outright) or **spread** (cover the run line)\n` +
      `• Odds lock at submission — bigger underdogs = more points\n` +
      `• Picks lock when the game starts — cancel anytime before that\n` +
      `• Grading runs automatically after games finish\n` +
      `• Type **my picks** to see your picks, **cancel** to cancel one\n\n` +
      `Head to #read-me in the server for full rules and scoring info.\n\n` +
      `💰 **Entry fee:** Send $300 to **@kblum24** on Venmo to lock in your spot.\n\n` +
      `When you're ready to make your first picks, just DM me anything and I'll pull up the games. Let's get it. 😈`
    );
    logger.info('guildMemberAdd', `Welcomed new member ${member.user.username}`);
  } catch (err) {
    logger.error('guildMemberAdd', `Failed to DM new member ${member.user.username}`, err);
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

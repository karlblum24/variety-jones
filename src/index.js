require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { handleDM } = require('./handlers/dmHandler');
const { startGameNotifier } = require('./handlers/gameStartNotifier');
const { startGrader } = require('./handlers/grader');

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
    console.warn(`[warn] ${file} is missing "data" or "execute"`);
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  startGameNotifier(client);
  startGrader(client);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.DM) return;
  await handleDM(message);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const reply = { content: 'An error occurred while executing that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

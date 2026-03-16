const { postScoreboard } = require('./scoreboard');
const { postDailyRecap } = require('./dailyRecap');
const { runGrader } = require('./grader');

const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID;

const COMMANDS = `Admin commands:
!admin scoreboard — post scoreboard now
!admin recap — post daily recap now
!admin grade — run grader now`;

async function handleAdminCommand(message, client) {
  if (!ADMIN_DISCORD_ID) return;
  if (message.author.id !== ADMIN_DISCORD_ID) return;

  const input = message.content.trim().toLowerCase();
  if (!input.startsWith('!admin')) return;

  const command = input.replace('!admin', '').trim();

  try {
    if (command === 'scoreboard') {
      await message.reply('Posting scoreboard...');
      await postScoreboard(client);
      await message.reply('Done.');
    } else if (command === 'recap') {
      await message.reply('Posting recap...');
      await postDailyRecap(client);
      await message.reply('Done.');
    } else if (command === 'grade') {
      await message.reply('Running grader...');
      await runGrader();
      await message.reply('Done.');
    } else {
      await message.reply(COMMANDS);
    }
  } catch (err) {
    await message.reply(`Error: ${err.message}`);
  }
}

module.exports = { handleAdminCommand };

const { postScoreboard } = require('./scoreboard');
const { postDailyRecap } = require('./dailyRecap');
const { runGrader } = require('./grader');
const supabase = require('../database/supabase');

const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID;

const COMMANDS = `Admin commands:
!admin scoreboard — post scoreboard now
!admin recap — post daily recap now
!admin grade — run grader now
!admin paid <username> — mark player as paid
!admin unpaid <username> — mark player as unpaid`;

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
    } else if (command.startsWith('paid ') || command.startsWith('unpaid ')) {
      const isPaid = command.startsWith('paid ');
      const username = command.replace(/^(paid|unpaid) /, '').trim();

      if (!username) {
        await message.reply('Usage: !admin paid <username> or !admin unpaid <username>');
        return;
      }

      const { data, error } = await supabase
        .from('players')
        .update({ has_paid: isPaid })
        .ilike('discord_username', username)
        .select();

      if (error) {
        await message.reply(`DB error: ${error.message}`);
        return;
      }

      if (!data || data.length === 0) {
        await message.reply(`No player found with username "${username}".`);
        return;
      }

      await message.reply(`✅ **${data[0].discord_username}** marked as **${isPaid ? 'PAID' : 'UNPAID'}**.`);
    } else {
      await message.reply(COMMANDS);
    }
  } catch (err) {
    await message.reply(`Error: ${err.message}`);
  }
}

module.exports = { handleAdminCommand };

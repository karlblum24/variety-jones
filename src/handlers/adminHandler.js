const { postScoreboard } = require('./scoreboard');
const { postSignupReminder } = require('./dailySignupReminder');
const { postDailyRecap } = require('./dailyRecap');
const { runGrader } = require('./grader');
const { sendWeeklyReminders } = require('./weeklyReminder');
const { clearOddsCache } = require('../services/oddsApi');
const supabase = require('../database/supabase');

const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID;

const COMMANDS = `Admin commands:
!admin scoreboard — post scoreboard now
!admin recap — post daily recap now
!admin grade — run grader now
!admin remind — send weekly reminders to players with picks remaining
!admin paid <username> — mark player as paid
!admin unpaid <username> — mark player as unpaid
!admin players — list all players with onboarding and payment status
!admin clearcache — force fresh odds fetch from API
!admin scan — compare server members vs database
!admin signupreminder — post signup reminder to #general now`;

async function handleAdminCommand(message, client) {
  if (!ADMIN_DISCORD_ID) return false;
  if (message.author.id !== ADMIN_DISCORD_ID) return false;

  const input = message.content.trim().toLowerCase();
  if (!input.startsWith('!admin')) return false;

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
      await runGrader(client);
      await message.reply('Done.');
    } else if (command === 'clearcache') {
      clearOddsCache();
      await message.reply('✅ Odds cache cleared. Next pick request will fetch fresh data from the API.');
    } else if (command === 'remind') {
      await message.reply('Sending weekly reminders...');
      await sendWeeklyReminders(client);
      await message.reply('Done.');
    } else if (command.startsWith('paid ') || command.startsWith('unpaid ')) {
      const isPaid = command.startsWith('paid ');
      const username = command.replace(/^(paid|unpaid) /, '').trim();

      if (!username) {
        await message.reply('Usage: !admin paid <username> or !admin unpaid <username>');
        return true;
      }

      const { data, error } = await supabase
        .from('players')
        .update({ has_paid: isPaid })
        .ilike('discord_username', username)
        .select();

      if (error) {
        await message.reply(`DB error: ${error.message}`);
        return true;
      }

      if (!data || data.length === 0) {
        await message.reply(`No player found with username "${username}".`);
        return true;
      }

      await message.reply(`✅ **${data[0].discord_username}** marked as **${isPaid ? 'PAID' : 'UNPAID'}**.`);
    } else if (command === 'players') {
      const { data, error } = await supabase
        .from('players')
        .select('discord_username, display_name, venmo_handle, has_paid')
        .order('discord_username', { ascending: true });

      if (error) {
        await message.reply(`DB error: ${error.message}`);
        return true;
      }

      if (!data || data.length === 0) {
        await message.reply('No players found.');
        return true;
      }

      const lines = data.map(p => {
        const name = p.display_name || '❌ no name';
        const venmo = p.venmo_handle || '❌ no venmo';
        const paid = p.has_paid ? '✅ paid' : '💰 unpaid';
        return `**${p.discord_username}** — ${name} | @${venmo} | ${paid}`;
      });

      const chunks = [];
      let current = '';
      for (const line of lines) {
        if (current.length + line.length + 1 > 1900) {
          chunks.push(current);
          current = line;
        } else {
          current += (current ? '\n' : '') + line;
        }
      }
      if (current) chunks.push(current);

      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else if (command === 'scan') {
      await message.reply('Scanning server members vs database...');

      // Get all members from the guild
      const guild = message.guild || client.guilds.cache.first();
      if (!guild) {
        await message.reply('Could not find server. Run this command from inside the server.');
        return true;
      }

      // Fetch all members
      const members = await guild.members.fetch();

      // Get all players from DB
      const { data: players, error } = await supabase
        .from('players')
        .select('discord_id, discord_username, display_name, venmo_handle');

      if (error) {
        await message.reply(`DB error: ${error.message}`);
        return true;
      }

      const dbIds = new Set((players || []).map(p => p.discord_id));

      // Find members not in DB (excluding bots)
      const missing = members.filter(m =>
        !m.user.bot && !dbIds.has(m.user.id)
      );

      // Find DB players not in server
      const memberIds = new Set(members.map(m => m.user.id));
      const leftServer = (players || []).filter(p => !memberIds.has(p.discord_id));

      let report = `**Server Scan Results**\n\n`;
      report += `✅ In server + in DB: ${members.filter(m => !m.user.bot && dbIds.has(m.user.id)).size}\n`;
      report += `⚠️ In server but NOT in DB (never DMed bot): ${missing.size}\n`;
      report += `👻 In DB but NOT in server (left server): ${leftServer.length}\n\n`;

      if (missing.size > 0) {
        report += `**Missing from DB:**\n`;
        missing.forEach(m => {
          report += `• ${m.user.username} (${m.user.id})\n`;
        });
      }

      if (leftServer.length > 0) {
        report += `\n**Left server but in DB:**\n`;
        leftServer.forEach(p => {
          report += `• ${p.discord_username} — ${p.display_name || 'no name'}\n`;
        });
      }

      // Chunk if needed
      const chunks = [];
      let current = '';
      for (const line of report.split('\n')) {
        if (current.length + line.length + 1 > 1900) {
          chunks.push(current);
          current = line;
        } else {
          current += (current ? '\n' : '') + line;
        }
      }
      if (current) chunks.push(current);
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else if (command === 'signupreminder') {
      await message.reply('Posting signup reminder...');
      await postSignupReminder(client);
      await message.reply('Done.');
    } else {
      await message.reply(COMMANDS);
    }
  } catch (err) {
    await message.reply(`Error: ${err.message}`);
    return true;
  }
  return true;
}

module.exports = { handleAdminCommand };

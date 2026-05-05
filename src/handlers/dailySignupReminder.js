const cron = require('node-cron');
const supabase = require('../database/supabase');

const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID;

async function postUnpaidReminder(client, channel) {
  try {
    const { data: unpaidPlayers, error } = await supabase
      .from('players')
      .select('discord_id, discord_username, display_name')
      .eq('has_paid', false);

    if (error) throw error;

    if (!unpaidPlayers || unpaidPlayers.length === 0) {
      console.log('[signupReminder] All players paid — skipping unpaid reminder.');
      return;
    }

    const lines = unpaidPlayers.map(p => {
      const mention = p.discord_id ? `<@${p.discord_id}>` : p.discord_username;
      return `• ${mention}`;
    }).join('\n');

    await channel.send(
      `💰 **Daily Payment Reminder**\n\n` +
      `The following players have not yet paid their $300 entry fee:\n\n` +
      `${lines}\n\n` +
      `Please Venmo **@kblum24** or text **732-779-3392** to sort it out. ` +
      `You must pay to be eligible for prizes. 🥺`
    );

    console.log(`[signupReminder] Posted unpaid reminder for ${unpaidPlayers.length} player(s).`);
  } catch (err) {
    console.error('[signupReminder] Error posting unpaid reminder:', err);
  }
}

async function postUnpaidReminderStandalone(client) {
  const channel = await client.channels.fetch(GENERAL_CHANNEL_ID);
  await postUnpaidReminder(client, channel);
}

async function postSignupReminder(client) {
  console.log('[signupReminder] Running daily signup reminder...');
  try {
    const guild = client.guilds.cache.first();
    if (!guild) {
      console.error('[signupReminder] Could not find guild.');
      return;
    }

    const members = await guild.members.fetch();

    const { data: players, error } = await supabase
      .from('players')
      .select('discord_id');

    if (error) throw error;

    const dbIds = new Set((players || []).map(p => p.discord_id));

    const missing = members.filter(m =>
      !m.user.bot && !dbIds.has(m.user.id)
    );

    if (missing.size === 0) {
      console.log('[signupReminder] All members in DB — skipping signup reminder.');
      // Still check unpaid even if everyone is registered
      const ch = await client.channels.fetch(GENERAL_CHANNEL_ID);
      await postUnpaidReminder(client, ch);
      return;
    }

    // Build mentions of everyone in the server (to notify the group)
    const allMentions = members
      .filter(m => !m.user.bot)
      .map(m => `<@${m.user.id}>`)
      .join(' ');

    // List of missing members
    const missingList = missing
      .map(m => `• ${m.user.username}`)
      .join('\n');

    const message =
      `👋 **Daily Sign-Up Reminder — 2026 PICKS LEAGUE**\n\n` +
      `${allMentions}\n\n` +
      `The following server members haven't signed up yet. ` +
      `If you know them, please reach out and ask them to DM **SUBMISSION SLAVE** to complete their registration:\n\n` +
      `${missingList}\n\n` +
      `To sign up: just DM the bot anything and it will walk you through it. ` +
      `You need to be registered before you can make picks. 🥺`;

    const channel = await client.channels.fetch(GENERAL_CHANNEL_ID);

    // Chunk if needed
    if (message.length <= 1900) {
      await channel.send(message);
    } else {
      // Send mentions first, then the missing list
      const intro =
        `👋 **Daily Sign-Up Reminder — 2026 PICKS LEAGUE**\n\n` +
        `${allMentions}`;
      const body =
        `The following server members haven't signed up yet. ` +
        `If you know them, please reach out and ask them to DM **SUBMISSION SLAVE** to complete their registration:\n\n` +
        `${missingList}\n\n` +
        `To sign up: just DM the bot anything and it will walk you through it. 🥺`;
      await channel.send(intro);
      await channel.send(body);
    }

    // Also call unpaid reminder
    await postUnpaidReminder(client, channel);

    console.log(`[signupReminder] Posted reminder for ${missing.size} missing member(s).`);
  } catch (err) {
    console.error('[signupReminder] Error:', err);
  }
}

function startSignupReminder(client) {
  cron.schedule('0 10 * * *', () => postSignupReminder(client), {
    timezone: 'America/New_York',
  });
  console.log('[signupReminder] Scheduled daily signup reminder at 10:00 AM ET.');
}

module.exports = { startSignupReminder, postSignupReminder, postUnpaidReminderStandalone };

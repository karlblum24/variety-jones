const cron = require('node-cron');
const supabase = require('../database/supabase');

const IS_PRESEASON = process.env.IS_PRESEASON === 'true';

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

async function sendWeeklyReminders(client) {
  console.log('[weeklyReminder] Running weekly reminder job...');

  if (IS_PRESEASON) {
    console.log('[weeklyReminder] Preseason mode — skipping reminder.');
    return;
  }

  const now = new Date();
  const weekNumber = getISOWeek(now);
  const seasonYear = now.getFullYear();

  try {
    // Get all players
    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('id, discord_id, discord_username');

    if (playersError) throw playersError;

    const { data: picksThisWeek, error: picksError } = await supabase
      .from('picks')
      .select('player_id')
      .eq('week_number', weekNumber)
      .eq('season_year', seasonYear)
      .eq('cancelled', false);

    if (picksError) throw picksError;

    // Count picks per player
    const pickCounts = {};
    for (const pick of picksThisWeek || []) {
      pickCounts[pick.player_id] = (pickCounts[pick.player_id] || 0) + 1;
    }

    const { picksPerWeek } = require('../config/scoring');

    let reminded = 0;

    for (const player of players || []) {
      const used = pickCounts[player.id] || 0;
      const remaining = picksPerWeek - used;

      if (remaining <= 0) continue;

      try {
        const user = await client.users.fetch(player.discord_id);
        await user.send(
          `⚾ **2026 PICKS LEAGUE — Sunday Reminder**\n\n` +
          `Hey! You still have **${remaining} pick${remaining === 1 ? '' : 's'}** remaining this week.\n\n` +
          `The week ends tonight — don't leave points on the table. ` +
          `DM me anything to pull up today's games and get your picks in.\n\n` +
          `Don't sleep on it. 😈`
        );
        reminded++;
        console.log(`[weeklyReminder] Reminded ${player.discord_username} (${remaining} picks left)`);
      } catch (err) {
        console.error(`[weeklyReminder] Failed to DM ${player.discord_username}:`, err.message);
      }
    }

    console.log(`[weeklyReminder] Done. Reminded ${reminded} player(s).`);
  } catch (err) {
    console.error('[weeklyReminder] Fatal error:', err);
  }
}

function startWeeklyReminder(client) {
  // Every Saturday and Sunday at 10:00 AM ET
  cron.schedule('0 10 * * 6', () => sendWeeklyReminders(client), {
    timezone: 'America/New_York',
  });
  cron.schedule('0 10 * * 0', () => sendWeeklyReminders(client), {
    timezone: 'America/New_York',
  });
  console.log('[weeklyReminder] Scheduled Saturday and Sunday reminders at 10:00 AM ET.');
}

module.exports = { startWeeklyReminder, sendWeeklyReminders };

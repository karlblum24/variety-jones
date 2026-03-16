const supabase = require('../database/supabase');
const { getPointsForResult } = require('../config/scoring');

function formatOdds(odds) {
  return odds >= 0 ? `+${odds}` : `${odds}`;
}

async function startGameNotifier(client) {
  setInterval(async () => {
    let picks;
    try {
      const { data, error } = await supabase
        .from('picks')
        .select('*, players(discord_id)')
        .is('result', null)
        .not('odds_at_lock', 'is', null)
        .lte('game_start_time', new Date().toISOString())
        .eq('notified', false)
        .eq('cancelled', false);

      if (error) throw error;
      picks = data;
    } catch (err) {
      console.error('[notifier] Error querying picks:', err);
      return;
    }

    for (const pick of picks) {
      const discordId = pick.players?.discord_id;
      if (!discordId) continue;

      const lockedOdds = pick.odds_at_lock;
      const win = getPointsForResult(lockedOdds, 'win');
      const loss = getPointsForResult(lockedOdds, 'loss');

      try {
        const user = await client.users.fetch(discordId);

        await user.send(
          `⚾ Game time! Your locked odds were set at submission for ${pick.team_picked}:\n` +
          `Your pick: ${pick.team_picked} ${pick.pick_type}\n` +
          `Locked odds: ${formatOdds(lockedOdds)}\n` +
          `Win = +${win} pts | Loss = ${loss} pts\n` +
          `Good luck!`
        );

        await supabase
          .from('picks')
          .update({ notified: true })
          .eq('id', pick.id);
      } catch (err) {
        console.error(`[notifier] Error DMing user ${discordId}:`, err);
        try {
          await supabase
            .from('picks')
            .update({ notified: true })
            .eq('id', pick.id);
        } catch (updateErr) {
          console.error(`[notifier] Failed to mark pick ${pick.id} as notified after DM error:`, updateErr);
        }
      }
    }
  }, 60 * 1000);
}

module.exports = { startGameNotifier };

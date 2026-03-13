const supabase = require('../database/supabase');
const { getPointsForResult } = require('../config/scoring');

const notifiedPickIds = new Set();

function getOpponent(pick, teamPicked) {
  if (pick.home_team && pick.away_team) {
    return pick.home_team.toLowerCase() === teamPicked.toLowerCase() ? pick.away_team : pick.home_team;
  }
  return 'opponent';
}

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
        .lte('game_start_time', new Date().toISOString());

      if (error) throw error;
      picks = data;
    } catch (err) {
      console.error('[notifier] Error querying picks:', err);
      return;
    }

    for (const pick of picks) {
      if (notifiedPickIds.has(pick.id)) continue;

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

        notifiedPickIds.add(pick.id);
      } catch (err) {
        console.error(`[notifier] Error DMing user ${discordId}:`, err);
      }
    }
  }, 60 * 1000);
}

module.exports = { startGameNotifier };

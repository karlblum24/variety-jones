const supabase = require('../database/supabase');
const { getPointsForResult } = require('../config/scoring');
const { getLongestShotLeader } = require('../services/picks');

const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID;

function formatOdds(odds) {
  return odds >= 0 ? `+${odds}` : `${odds}`;
}

async function startGameNotifier(client) {
  setInterval(async () => {
    let picks;
    try {
      const { data, error } = await supabase
        .from('picks')
        .select('*, players(discord_id, discord_username)')
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

    if (!picks || picks.length === 0) return;

    // Group picks by game_id
    const gameGroups = {};
    for (const pick of picks) {
      if (!gameGroups[pick.game_id]) {
        gameGroups[pick.game_id] = {
          game_id: pick.game_id,
          game_start_time: pick.game_start_time,
          home_team: pick.home_team,
          away_team: pick.away_team,
          picks: [],
        };
      }
      gameGroups[pick.game_id].picks.push(pick);
    }

    // Post one #general announcement per game
    if (GENERAL_CHANNEL_ID) {
      try {
        const channel = await client.channels.fetch(GENERAL_CHANNEL_ID);

        for (const group of Object.values(gameGroups)) {
          // Build team buckets
          const teamBuckets = {};
          for (const pick of group.picks) {
            const team = pick.team_picked;
            if (!teamBuckets[team]) teamBuckets[team] = [];
            const discordId = pick.players?.discord_id;
            const pickLabel = pick.pick_type === 'spread'
              ? `spread${pick.spread_point !== null ? ' ' + (pick.spread_point > 0 ? '+' + pick.spread_point : pick.spread_point) : ''}`
              : 'ml';
            const mention = discordId ? `<@${discordId}>` : (pick.players?.discord_username || 'Unknown');
            teamBuckets[team].push(`${mention} (${pickLabel})`);
          }

          const awayTeam = group.away_team || 'Away';
          const homeTeam = group.home_team || 'Home';

          let msg = `⚾ **${awayTeam} @ ${homeTeam} just started!**\n\n`;

          for (const [team, mentions] of Object.entries(teamBuckets)) {
            msg += `**${team}:** ${mentions.join(', ')}\n`;
          }

          // Check for biggest boy contenders in this game
          try {
            const leader = await getLongestShotLeader();
            const leaderOdds = leader ? leader.odds_at_lock : 0;

            const biggestBoyPicks = group.picks.filter(p =>
              p.odds_at_lock > 0 && p.odds_at_lock > leaderOdds
            );

            if (biggestBoyPicks.length > 0) {
              msg += `\n\n👀 **BIGGEST BOY ALERT:**\n`;
              for (const p of biggestBoyPicks) {
                const discordId = p.players?.discord_id;
                const mention = discordId ? `<@${discordId}>` : (p.players?.discord_username || 'Unknown');
                const pickLabel = p.pick_type === 'spread'
                  ? `spread${p.spread_point !== null ? ' ' + (p.spread_point > 0 ? '+' + p.spread_point : p.spread_point) : ''}`
                  : 'ml';
                msg += `${mention} is on **${p.team_picked}** (${pickLabel}) at **+${p.odds_at_lock}** — `;
                msg += `if this wins, we have a new longest shot leader! 😤\n`;
              }
              msg += `Current leader: ${leader ? `**${leader.players.discord_username}** at **+${leader.odds_at_lock}**` : 'unclaimed'}`;
            }
          } catch (err) {
            console.error('[notifier] Error checking longest shot:', err);
          }

          msg += `\n\nGood luck out there! 🤞`;

          await channel.send(msg);
          console.log(`[notifier] Posted game start announcement for ${awayTeam} @ ${homeTeam}`);
        }
      } catch (err) {
        console.error('[notifier] Error posting game start announcement to #general:', err);
      }
    }

    // DM individual players and mark notified
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

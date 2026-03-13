const supabase = require('../database/supabase');
const { getPointsForResult } = require('../config/scoring');

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

async function fetchOddsForGame(gameId) {
  const params = new URLSearchParams({
    apiKey: process.env.ODDS_API_KEY,
    regions: 'us',
    markets: 'h2h,spreads',
    oddsFormat: 'american',
  });

  const res = await fetch(`${ODDS_API_BASE}/sports/baseball_mlb/odds?${params}`);
  if (!res.ok) return null;
  const games = await res.json();
  return games.find(g => g.id === gameId) ?? null;
}

function extractOdds(gameData, teamPicked, pickType) {
  const marketKey = pickType === 'moneyline' ? 'h2h' : 'spreads';
  for (const bookmaker of gameData.bookmakers) {
    const market = bookmaker.markets.find(m => m.key === marketKey);
    if (market) {
      const outcome = market.outcomes.find(o => o.name.toLowerCase() === teamPicked.toLowerCase());
      if (outcome) return outcome.price;
    }
  }
  return null;
}

function getOpponent(gameData, teamPicked) {
  if (gameData.home_team.toLowerCase() === teamPicked.toLowerCase()) return gameData.away_team;
  return gameData.home_team;
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
        .is('odds_at_lock', null)
        .lte('game_start_time', new Date().toISOString());

      if (error) throw error;
      picks = data;
    } catch (err) {
      console.error('[notifier] Error querying picks:', err);
      return;
    }

    for (const pick of picks) {
      let gameData;
      try {
        gameData = await fetchOddsForGame(pick.game_id);
      } catch (err) {
        console.error(`[notifier] Error fetching odds for game ${pick.game_id}:`, err);
        continue;
      }

      if (!gameData) continue;

      const closingOdds = extractOdds(gameData, pick.team_picked, pick.pick_type);
      if (closingOdds === null) continue;

      try {
        const { error } = await supabase
          .from('picks')
          .update({ odds_at_lock: closingOdds })
          .eq('id', pick.id);

        if (error) throw error;
      } catch (err) {
        console.error(`[notifier] Error updating odds_at_lock for pick ${pick.id}:`, err);
        continue;
      }

      const discordId = pick.players?.discord_id;
      if (!discordId) continue;

      try {
        const user = await client.users.fetch(discordId);
        const opponent = getOpponent(gameData, pick.team_picked);
        const win = getPointsForResult(closingOdds, 'win');
        const loss = getPointsForResult(closingOdds, 'loss');

        await user.send(
          `⚾ Game time! Here's your closing line for ${pick.team_picked} vs ${opponent}:\n` +
          `Your pick: ${pick.team_picked} ${pick.pick_type}\n` +
          `Closing odds: ${formatOdds(closingOdds)}\n` +
          `Win = +${win} pts | Loss = ${loss} pts\n` +
          `Good luck!`
        );
      } catch (err) {
        console.error(`[notifier] Error DMing user ${discordId}:`, err);
      }
    }
  }, 60 * 1000);
}

module.exports = { startGameNotifier };

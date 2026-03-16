const cron = require('node-cron');
const supabase = require('../database/supabase');
const { getPointsForResult } = require('../config/scoring');

const IS_PRESEASON = process.env.IS_PRESEASON === 'true';

async function fetchMLBSchedule(date, gameType) {
  const dateStr = date.toISOString().split('T')[0];
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&gameType=${gameType}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB Stats API error: ${res.status}`);
  return res.json();
}

function fuzzyMatchTeam(mlbTeamName, ourTeamName) {
  const lastWord = ourTeamName.trim().split(' ').pop().toLowerCase();
  return mlbTeamName.toLowerCase().includes(lastWord);
}

function findGameInSchedule(scheduleData, teamPicked) {
  for (const date of scheduleData.dates || []) {
    for (const game of date.games || []) {
      const mlbAway = game.teams?.away?.team?.name || '';
      const mlbHome = game.teams?.home?.team?.name || '';
      if (fuzzyMatchTeam(mlbAway, teamPicked) || fuzzyMatchTeam(mlbHome, teamPicked)) {
        return game;
      }
    }
  }
  return null;
}

function determineResult(game, teamPicked, pickType, spreadPoint) {
  const awayScore = game.teams?.away?.score;
  const homeScore = game.teams?.home?.score;
  const mlbAway = game.teams?.away?.team?.name || '';
  const mlbHome = game.teams?.home?.team?.name || '';

  const isHome = fuzzyMatchTeam(mlbHome, teamPicked);
  const pickedScore = isHome ? homeScore : awayScore;
  const opposingScore = isHome ? awayScore : homeScore;

  if (pickType === 'moneyline') {
    return pickedScore > opposingScore ? 'win' : 'loss';
  }

  if (pickType === 'spread') {
    if (spreadPoint !== null && spreadPoint !== undefined) {
      // Cover if: (pickedScore - opposingScore) > -spreadPoint
      // e.g. spreadPoint = -1.5 → must win by 2+
      // e.g. spreadPoint = +1.5 → can lose by 1
      const margin = pickedScore - opposingScore;
      if (margin === -spreadPoint) return 'push';
      return margin > -spreadPoint ? 'win' : 'loss';
    }
    // Fallback: no spread_point stored, grade on outright result
    return pickedScore > opposingScore ? 'win' : 'loss';
  }

  return 'loss';
}


async function runGrader() {
  console.log('[grader] Running daily grading job...');

  const { data: picks, error } = await supabase
    .from('picks')
    .select('*')
    .is('result', null)
    .not('odds_at_lock', 'is', null)
    .lt('game_start_time', new Date().toISOString());

  if (error) {
    console.error('[grader] Error querying picks:', error);
    return;
  }

  console.log(`[grader] Found ${picks.length} pick(s) to grade.`);

  for (const pick of picks) {
    try {
      const gameDate = new Date(pick.game_start_time);
      let scheduleData = await fetchMLBSchedule(gameDate, 'S');
      let game = findGameInSchedule(scheduleData, pick.team_picked);

      if (!game) {
        scheduleData = await fetchMLBSchedule(gameDate, 'R');
        game = findGameInSchedule(scheduleData, pick.team_picked);
      }

      if (!game) {
        console.warn(`[grader] No MLB schedule match found for pick ${pick.id} (${pick.team_picked})`);
        continue;
      }

      if (game.status?.detailedState !== 'Final') {
        console.log(`[grader] Game not final yet for pick ${pick.id}, skipping.`);
        continue;
      }

      const result = determineResult(game, pick.team_picked, pick.pick_type, pick.spread_point);
      const pointsAwarded = getPointsForResult(pick.odds_at_lock, result);

      const { error: updateError } = await supabase
        .from('picks')
        .update({ result, points_awarded: pointsAwarded })
        .eq('id', pick.id);

      if (updateError) throw updateError;

      console.log(`[grader] Graded pick ${pick.id}: ${pick.team_picked} ${pick.pick_type} → ${result} (${pointsAwarded} pts)`);
    } catch (err) {
      console.error(`[grader] Error grading pick ${pick.id}:`, err);
    }
  }

  console.log('[grader] Grading job complete.');
}

function startGrader(client) {
  cron.schedule('0 5 * * *', runGrader, { timezone: 'America/New_York' });
  console.log('[grader] Scheduled daily grading job at 5:00 AM ET.');
}

module.exports = { startGrader, runGrader };

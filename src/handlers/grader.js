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
  const mlb = mlbTeamName.toLowerCase().trim();
  const our = ourTeamName.toLowerCase().trim();

  // Strategy 1: exact match
  if (mlb === our) return true;

  // Strategy 2: mlb name contains our full team name
  if (mlb.includes(our)) return true;

  // Strategy 3: our name contains mlb team name
  if (our.includes(mlb)) return true;

  // Strategy 4: all words in our name appear in mlb name
  const ourWords = our.split(' ').filter(w => w.length > 2);
  if (ourWords.length > 1 && ourWords.every(w => mlb.includes(w))) return true;

  // Strategy 5: last word match (fallback only for single-word nicknames)
  // Only use if our team name is a single word to avoid Sox/Red Sox collision
  const ourWordCount = our.trim().split(' ').length;
  if (ourWordCount === 1) {
    const lastWord = our.split(' ').pop();
    if (mlb.includes(lastWord)) return true;
  }

  return false;
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
    if (pickedScore === opposingScore) return 'push';
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


async function dmAdmin(client, message) {
  const adminId = process.env.ADMIN_DISCORD_ID;
  if (!client || !adminId) return;
  try {
    const user = await client.users.fetch(adminId);
    await user.send(message);
  } catch (err) {
    console.error('[grader] Failed to DM admin:', err);
  }
}

async function runGrader(client = null) {
  console.log('[grader] Running daily grading job...');
  try {
    const { data: picks, error } = await supabase
      .from('picks')
      .select('*')
      .is('result', null)
      .not('odds_at_lock', 'is', null)
      .eq('cancelled', false)
      .lt('game_start_time', new Date().toISOString());

    if (error) throw error;

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

    const staleThreshold = new Date(Date.now() - 18 * 60 * 60 * 1000);
    const stalePicks = picks.filter(p =>
      p.result === null &&
      new Date(p.game_start_time) < staleThreshold
    );
    if (stalePicks.length > 0) {
      const staleList = stalePicks.map(p =>
        `• ${p.team_picked} (${p.pick_type}) — started ${new Date(p.game_start_time).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`
      ).join('\n');
      await dmAdmin(client,
        `⚠️ ${stalePicks.length} pick(s) still ungraded 18+ hours after game start:\n\n${staleList}\n\nCheck MLB Stats API or grade manually in Supabase.`
      );
    }

    console.log('[grader] Grading job complete.');
  } catch (err) {
    console.error('[grader] Fatal error in grader:', err);
    await dmAdmin(client, `🚨 Grader failed at ${new Date().toISOString()}\nError: ${err.message}`);
  }
}

function startGrader(client) {
  cron.schedule('0 6 * * *', () => runGrader(client), { timezone: 'America/New_York' });
  console.log('[grader] Scheduled daily grading job at 6:00 AM ET.');
  cron.schedule('0 12 * * *', () => runGrader(client), { timezone: 'America/New_York' });
  console.log('[grader] Scheduled catch-up grading job at 12:00 PM ET.');
}

module.exports = { startGrader, runGrader };

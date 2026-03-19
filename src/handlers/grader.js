const cron = require('node-cron');
const supabase = require('../database/supabase');
const { getPointsForResult } = require('../config/scoring');

const IS_PRESEASON = process.env.IS_PRESEASON === 'true';

async function fetchMLBSchedule(date, gameType) {
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&gameType=${gameType}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB Stats API error: ${res.status}`);
  return res.json();
}

function normalizeTeamName(name) {
  if (!name) return '';
  return name.toLowerCase().trim()
    .replace(/\./g, '')           // remove periods (A.L., etc)
    .replace(/\s+/g, ' ');        // normalize whitespace
}

function teamsMatch(mlbName, oddsName) {
  const mlb = normalizeTeamName(mlbName);
  const odds = normalizeTeamName(oddsName);

  // Exact match
  if (mlb === odds) return true;

  // One contains the other
  if (mlb.includes(odds) || odds.includes(mlb)) return true;

  // All significant words in oddsName appear in mlbName
  const oddsWords = odds.split(' ').filter(w => w.length > 2);
  if (oddsWords.length > 0 && oddsWords.every(w => mlb.includes(w))) return true;

  return false;
}

function findGameInSchedule(scheduleData, homeTeam, awayTeam) {
  for (const date of scheduleData.dates || []) {
    for (const game of date.games || []) {
      const mlbAway = game.teams?.away?.team?.name || '';
      const mlbHome = game.teams?.home?.team?.name || '';

      // Match using both teams if available
      if (homeTeam && awayTeam) {
        if (teamsMatch(mlbHome, homeTeam) && teamsMatch(mlbAway, awayTeam)) {
          return game;
        }
        // Try reversed (in case home/away is swapped in one API)
        if (teamsMatch(mlbHome, awayTeam) && teamsMatch(mlbAway, homeTeam)) {
          return game;
        }
      }

      // Fallback: single team match if home/away not stored
      if (!homeTeam || !awayTeam) {
        const teamToFind = homeTeam || awayTeam;
        if (!teamToFind) continue; // both null — skip, can't match
        if (teamsMatch(mlbAway, teamToFind) || teamsMatch(mlbHome, teamToFind)) {
          return game;
        }
      }
    }
  }
  return null;
}

function determineResult(game, teamPicked, pickType, spreadPoint, homeTeam = null, awayTeam = null) {
  const awayScore = game.teams?.away?.score;
  const homeScore = game.teams?.home?.score;
  const mlbAway = game.teams?.away?.team?.name || '';
  const mlbHome = game.teams?.home?.team?.name || '';

  // Use stored team names if available for accurate home/away detection
  const pickedIsHome = homeTeam
    ? teamsMatch(mlbHome, homeTeam) && teamsMatch(teamPicked, homeTeam)
    : teamsMatch(mlbHome, teamPicked);
  const isHome = pickedIsHome;
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
        let scheduleData;
        let game = null;

        // Dual-team match — only when both are stored
        if (pick.home_team && pick.away_team) {
          scheduleData = await fetchMLBSchedule(gameDate, 'S');
          game = findGameInSchedule(scheduleData, pick.home_team, pick.away_team);
          if (!game) {
            scheduleData = await fetchMLBSchedule(gameDate, 'R');
            game = findGameInSchedule(scheduleData, pick.home_team, pick.away_team);
          }
        }

        // Single-team fallback — always runs if dual match failed or not attempted
        if (!game && pick.team_picked) {
          scheduleData = await fetchMLBSchedule(gameDate, 'S');
          game = findGameInSchedule(scheduleData, null, pick.team_picked);
          if (!game) {
            scheduleData = await fetchMLBSchedule(gameDate, 'R');
            game = findGameInSchedule(scheduleData, null, pick.team_picked);
          }
        }

        if (!game) {
          console.warn(`[grader] No MLB schedule match found for pick ${pick.id} (${pick.team_picked})`);
          continue;
        }

        const state = game.status?.detailedState;
        const TERMINAL_STATES = ['Final', 'Completed Early', 'Game Over'];
        const VOID_STATES = ['Cancelled', 'Postponed', 'Suspended'];

        if (VOID_STATES.some(s => state?.startsWith(s))) {
          const { error: voidError } = await supabase
            .from('picks')
            .update({ result: 'void', points_awarded: 0 })
            .eq('id', pick.id);
          if (voidError) throw voidError;
          console.log(`[grader] Voided pick ${pick.id}: ${pick.team_picked} — game ${state}`);

          // DM the player
          try {
            const { data: player } = await supabase
              .from('players')
              .select('discord_id')
              .eq('id', pick.player_id)
              .single();

            if (player?.discord_id && client) {
              const user = await client.users.fetch(player.discord_id);
              await user.send(
                `⚠️ **Pick Voided — ${pick.team_picked}**\n\n` +
                `Your ${pick.pick_type} pick on **${pick.team_picked}** was voided because the game was **${state.toLowerCase()}**.\n\n` +
                `Your pick slot has been returned and you can re-pick this game if it gets rescheduled. No points were lost.`
              );
            }
          } catch (dmErr) {
            console.error(`[grader] Failed to DM player about voided pick ${pick.id}:`, dmErr.message);
          }

          continue;
        }

        if (!TERMINAL_STATES.some(s => state?.startsWith(s))) {
          console.log(`[grader] Game not final yet for pick ${pick.id} (${state}), skipping.`);
          continue;
        }

        const result = determineResult(game, pick.team_picked, pick.pick_type, pick.spread_point, pick.home_team, pick.away_team);
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

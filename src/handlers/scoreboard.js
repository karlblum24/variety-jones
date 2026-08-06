const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const supabase = require('../database/supabase');
const { picksPerWeek } = require('../config/scoring');
const { getLongShotWinnerForHalf, getFirstHalfChampion } = require('../services/picks');

const SCOREBOARD_CHANNEL_ID = process.env.SCOREBOARD_CHANNEL_ID;
if (!SCOREBOARD_CHANNEL_ID) throw new Error('Missing env var: SCOREBOARD_CHANNEL_ID');
const IS_PRESEASON = process.env.IS_PRESEASON === 'true';

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function formatOdds(odds) {
  return odds >= 0 ? `+${odds}` : `${odds}`;
}

async function postScoreboard(client) {
  try {
    const now = new Date();
    const weekNumber = getISOWeek(now);
    const seasonYear = now.getFullYear();

    const [
      { data: allPlayers, error: playersError },
      { data: seasonRows, error: seasonError },
      { data: weekRows, error: weekTotalsError },
      { data: weekPicks, error: weekError },
      firstHalfLongShot,
      secondHalfLongShot,
      firstHalfChampion,
    ] = await Promise.all([
      supabase.from('players').select('id, discord_username'),
      supabase.from('player_season_totals').select('player_id, season_points').eq('season_year', seasonYear),
      supabase.from('player_week_totals').select('player_id, week_points').eq('season_year', seasonYear).eq('week_number', weekNumber),
      supabase.from('picks').select('player_id, result').eq('week_number', weekNumber).eq('season_year', seasonYear).eq('cancelled', false),
      getLongShotWinnerForHalf('first'),
      getLongShotWinnerForHalf('second'),
      getFirstHalfChampion(),
    ]);

    if (playersError) throw playersError;
    if (seasonError) throw seasonError;
    if (weekTotalsError) throw weekTotalsError;
    if (weekError) throw weekError;

    // Season and week totals come pre-aggregated from Postgres — one row per
    // player, so they can't be truncated by the PostgREST 1000-row cap.
    const seasonTotals = {};
    for (const row of seasonRows || []) {
      seasonTotals[row.player_id] = Number(row.season_points || 0);
    }

    const weekPoints = {};
    for (const row of weekRows || []) {
      weekPoints[row.player_id] = Number(row.week_points || 0);
    }

    // Count this week's picks submitted per player
    const weekPickCounts = {};
    for (const pick of weekPicks || []) {
      if (pick.result === 'void') continue;
      weekPickCounts[pick.player_id] = (weekPickCounts[pick.player_id] || 0) + 1;
    }

    // Build sorted player rows
    const rows = (allPlayers || [])
      .map(player => ({
        username: player.discord_username,
        seasonPts: seasonTotals[player.id] || 0,
        weekPts: weekPoints[player.id] || 0,
        picksUsed: weekPickCounts[player.id] || 0,
      }))
      .sort((a, b) => b.seasonPts - a.seasonPts);

    const medals = ['🥇', '🥈', '🥉'];

    const description = rows.length === 0
      ? '_No picks submitted yet._'
      : rows.map((row, i) => {
          const rank = i < 3 ? medals[i] : `${i + 1}.`;
          const picksLeft = IS_PRESEASON
            ? 'unlimited'
            : Math.max(0, picksPerWeek - row.picksUsed);
          return `${rank} **${row.username}** | Season: ${row.seasonPts} pts | This Week: ${row.weekPts} pts | Picks Left: ${picksLeft}`;
        }).join('\n');

    const firstHalfChampionValue = firstHalfChampion
      ? `**${firstHalfChampion.username}** — ${firstHalfChampion.points} pts (LOCKED)`
      : 'No graded first-half picks';
    const firstHalfValue = firstHalfLongShot
      ? `**${firstHalfLongShot.players.discord_username}** — ${firstHalfLongShot.team_picked} (${formatOdds(firstHalfLongShot.odds_at_lock)}) — ${firstHalfLongShot.points_awarded} pts (LOCKED)`
      : 'No qualifying winner';
    const secondHalfValue = secondHalfLongShot
      ? `**${secondHalfLongShot.players.discord_username}** — ${secondHalfLongShot.team_picked} (${formatOdds(secondHalfLongShot.odds_at_lock)}) — ${secondHalfLongShot.points_awarded} pts`
      : 'No winner yet — the 2H crown is up for grabs 👑';

    const footer = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' ET';

    const embed = new EmbedBuilder()
      .setTitle('⚾ 2026 PICKS LEAGUE Standings')
      .setColor(0x00ff00)
      .setDescription(description)
      .addFields(
        { name: '⭐ 1H CHAMPION', value: firstHalfChampionValue },
        { name: '🔒 LONG SHOT — 1H CHAMPION', value: firstHalfValue },
        { name: '🎯 LONG SHOT — 2H LEADER', value: secondHalfValue },
      )
      .setFooter({ text: `Last updated: ${footer}` });

    const channel = await client.channels.fetch(SCOREBOARD_CHANNEL_ID);
    await channel.send({ embeds: [embed] });

    console.log('[scoreboard] Posted scoreboard successfully.');
  } catch (err) {
    console.error('[scoreboard] Error posting scoreboard:', err);
  }
}

function startScoreboardScheduler(client) {
  cron.schedule('5 6 * * *', () => postScoreboard(client), { timezone: 'America/New_York' });
  console.log('[scoreboard] Scheduled daily scoreboard post at 6:05 AM ET.');
}

module.exports = { postScoreboard, startScoreboardScheduler };

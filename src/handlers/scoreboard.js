const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const supabase = require('../database/supabase');
const { picksPerWeek } = require('../config/scoring');

const SCOREBOARD_CHANNEL_ID = process.env.SCOREBOARD_CHANNEL_ID;
if (!SCOREBOARD_CHANNEL_ID) throw new Error('Missing env var: SCOREBOARD_CHANNEL_ID');
const IS_PRESEASON = process.env.IS_PRESEASON === 'true';
const HALF_CUTOFF = new Date('2026-07-14');

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

    let longestShotQuery = supabase
      .from('picks')
      .select('player_id, team_picked, odds_at_lock, points_awarded, players(discord_username)')
      .eq('result', 'win')
      .not('odds_at_lock', 'is', null)
      .order('odds_at_lock', { ascending: false })
      .limit(1);

    if (now < HALF_CUTOFF) {
      longestShotQuery = longestShotQuery.lt('game_start_time', HALF_CUTOFF.toISOString());
    } else {
      longestShotQuery = longestShotQuery.gte('game_start_time', HALF_CUTOFF.toISOString());
    }

    const [
      { data: allPlayers, error: playersError },
      { data: gradedPicks, error: gradedError },
      { data: weekPicks, error: weekError },
      { data: longestShotRows, error: longestShotError },
    ] = await Promise.all([
      supabase.from('players').select('id, discord_username'),
      supabase.from('picks').select('player_id, points_awarded, week_number, season_year').not('result', 'is', null),
      supabase.from('picks').select('player_id').eq('week_number', weekNumber).eq('season_year', seasonYear),
      longestShotQuery,
    ]);

    if (playersError) throw playersError;
    if (gradedError) throw gradedError;
    if (weekError) throw weekError;
    if (longestShotError) throw longestShotError;

    // Aggregate season totals per player
    const seasonTotals = {};
    for (const pick of gradedPicks || []) {
      seasonTotals[pick.player_id] = (seasonTotals[pick.player_id] || 0) + Number(pick.points_awarded);
    }

    // Aggregate this week's points per player
    const weekPoints = {};
    for (const pick of gradedPicks || []) {
      if (pick.week_number === weekNumber && pick.season_year === seasonYear) {
        weekPoints[pick.player_id] = (weekPoints[pick.player_id] || 0) + Number(pick.points_awarded);
      }
    }

    // Count this week's picks submitted per player
    const weekPickCounts = {};
    for (const pick of weekPicks || []) {
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

    const longestShot = longestShotRows && longestShotRows.length > 0 ? longestShotRows[0] : null;
    const longestShotValue = longestShot
      ? `**${longestShot.players.discord_username}** — ${longestShot.team_picked} (${formatOdds(longestShot.odds_at_lock)}) — ${longestShot.points_awarded} pts`
      : 'No winner yet this half!';

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
      .addFields({ name: '🎯 Longest Shot Award', value: longestShotValue })
      .setFooter({ text: `Last updated: ${footer}` });

    const channel = await client.channels.fetch(SCOREBOARD_CHANNEL_ID);
    await channel.send({ embeds: [embed] });

    console.log('[scoreboard] Posted scoreboard successfully.');
  } catch (err) {
    console.error('[scoreboard] Error posting scoreboard:', err);
  }
}

function startScoreboardScheduler(client) {
  cron.schedule('5 5 * * *', () => postScoreboard(client), { timezone: 'America/New_York' });
  console.log('[scoreboard] Scheduled daily scoreboard post at 5:05 AM ET.');
}

module.exports = { postScoreboard, startScoreboardScheduler };

const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const supabase = require('../database/supabase');

const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_KEY;
const IS_PRESEASON = process.env.IS_PRESEASON === 'true';

if (!GENERAL_CHANNEL_ID) throw new Error('Missing env var: GENERAL_CHANNEL_ID');
if (!ANTHROPIC_API_KEY) throw new Error('Missing env var: ANTHROPIC_KEY');

function formatOdds(odds) {
  return odds >= 0 ? `+${odds}` : `${odds}`;
}

async function buildRecapData() {
  const now = new Date();

  // Yesterday window: midnight to midnight ET approximated in UTC
  const todayMidnightET = new Date(now);
  todayMidnightET.setHours(4, 0, 0, 0); // 4am UTC = midnight ET
  const yesterdayMidnightET = new Date(todayMidnightET);
  yesterdayMidnightET.setDate(yesterdayMidnightET.getDate() - 1);

  // Fetch yesterday's graded picks with player info
  const { data: yesterdayPicks, error: yesterdayError } = await supabase
    .from('picks')
    .select('*, players(discord_username)')
    .not('result', 'is', null)
    .gte('game_start_time', yesterdayMidnightET.toISOString())
    .lt('game_start_time', todayMidnightET.toISOString());

  if (yesterdayError) throw yesterdayError;

  // Fetch all graded picks for league standings
  const { data: allPicks, error: allError } = await supabase
    .from('picks')
    .select('player_id, points_awarded, players(discord_username)')
    .not('result', 'is', null);

  if (allError) throw allError;

  if (!yesterdayPicks || yesterdayPicks.length === 0) {
    return null; // No picks to recap
  }

  // Aggregate yesterday's points per player
  const yesterdayTotals = {};
  for (const pick of yesterdayPicks) {
    const name = pick.players?.discord_username || 'Unknown';
    if (!yesterdayTotals[name]) yesterdayTotals[name] = { points: 0, picks: [] };
    yesterdayTotals[name].points += Number(pick.points_awarded || 0);
    yesterdayTotals[name].picks.push(pick);
  }

  // Top scorer yesterday
  const topScorerYesterday = Object.entries(yesterdayTotals)
    .sort((a, b) => b[1].points - a[1].points)[0];

  // Bad day: lost a pick with negative odds (was a favorite)
  const badDayPick = yesterdayPicks
    .filter(p => p.result === 'loss' && p.odds_at_lock !== null && p.odds_at_lock < -150)
    .sort((a, b) => a.odds_at_lock - b.odds_at_lock)[0] || null;

  // Long shot win: biggest positive odds win yesterday
  const longShotWin = yesterdayPicks
    .filter(p => p.result === 'win' && p.odds_at_lock !== null && p.odds_at_lock > 0)
    .sort((a, b) => b.odds_at_lock - a.odds_at_lock)[0] || null;

  // League standings
  const seasonTotals = {};
  for (const pick of allPicks || []) {
    const name = pick.players?.discord_username || 'Unknown';
    seasonTotals[name] = (seasonTotals[name] || 0) + Number(pick.points_awarded || 0);
  }
  const leagueLeader = Object.entries(seasonTotals)
    .sort((a, b) => b[1] - a[1])[0];

  return {
    date: yesterdayMidnightET.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }),
    isPreseason: IS_PRESEASON,
    topScorerYesterday: topScorerYesterday
      ? { name: topScorerYesterday[0], points: topScorerYesterday[1].points }
      : null,
    yesterdayPlayerSummaries: Object.entries(yesterdayTotals).map(([name, data]) => ({
      name,
      points: data.points,
      wins: data.picks.filter(p => p.result === 'win').length,
      losses: data.picks.filter(p => p.result === 'loss').length,
    })),
    leagueLeader: leagueLeader
      ? { name: leagueLeader[0], points: leagueLeader[1] }
      : null,
    longShotWin: longShotWin
      ? {
          name: longShotWin.players?.discord_username,
          team: longShotWin.team_picked,
          odds: formatOdds(longShotWin.odds_at_lock),
          points: longShotWin.points_awarded,
        }
      : null,
    badDay: badDayPick
      ? {
          name: badDayPick.players?.discord_username,
          team: badDayPick.team_picked,
          odds: formatOdds(badDayPick.odds_at_lock),
          points: badDayPick.points_awarded,
        }
      : null,
  };
}

async function generateRecapMessage(data) {
  const prompt = `You are SUBMISSION SLAVE — a degenerate, trash-talking,
unnervingly horny baseball picks bot who runs a league called the 2026 PICKS LEAGUE.
You call the players "daddy" and "big boy", you are sassy and mean when
people lose, you hype up winners like they just won the World Series, and
you roast bad beats with zero mercy. You have a flair for the dramatic.
Write the daily recap for yesterday's results in this voice — one flowing
message, no bullet points or headers, like an unhinged sports commentator
who has had too much to drink. End with a horny hype line for today's games.
Keep it under 1800 characters.

Here is yesterday's data:
${JSON.stringify(data, null, 2)}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${err}`);
  }

  const result = await response.json();
  return result.content?.[0]?.text || 'No recap generated.';
}

function chunkMessage(text, limit = 1900) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    // Break at last newline before limit
    let cutoff = remaining.lastIndexOf('\n', limit);
    if (cutoff === -1) cutoff = limit;
    chunks.push(remaining.slice(0, cutoff));
    remaining = remaining.slice(cutoff).trim();
  }
  return chunks;
}

async function postDailyRecap(client) {
  console.log('[dailyRecap] Running daily recap job...');

  try {
    const data = await buildRecapData();

    if (!data) {
      console.log('[dailyRecap] No graded picks yesterday, skipping recap.');
      return;
    }

    const message = await generateRecapMessage(data);
    const chunks = chunkMessage(message);

    const channel = await client.channels.fetch(GENERAL_CHANNEL_ID);

    for (const chunk of chunks) {
      await channel.send(chunk);
    }

    console.log('[dailyRecap] Posted daily recap successfully.');
  } catch (err) {
    console.error('[dailyRecap] Error posting daily recap:', err);
  }
}

function startDailyRecap(client) {
  cron.schedule('0 9 * * *', () => postDailyRecap(client), {
    timezone: 'America/New_York',
  });
  console.log('[dailyRecap] Scheduled daily recap at 9:00 AM ET.');
}

module.exports = { startDailyRecap, postDailyRecap };

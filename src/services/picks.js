const supabase = require('../database/supabase');

async function getOrCreatePlayer(discordId, discordUsername) {
  const { data: existing } = await supabase
    .from('players')
    .select('*')
    .eq('discord_id', discordId)
    .maybeSingle();

  if (existing) {
    if (existing.discord_username !== discordUsername) {
      await supabase
        .from('players')
        .update({ discord_username: discordUsername })
        .eq('id', existing.id);
    }
    return { ...existing, discord_username: discordUsername };
  }

  const { data: created, error } = await supabase
    .from('players')
    .insert({ discord_id: discordId, discord_username: discordUsername })
    .select()
    .single();

  if (error) throw error;
  return { ...created, isNew: true };
}

async function getPicksThisWeek(playerId, weekNumber, seasonYear) {
  const { data, error } = await supabase
    .from('picks')
    .select('*')
    .eq('player_id', playerId)
    .eq('week_number', weekNumber)
    .eq('season_year', seasonYear)
    .eq('cancelled', false)
    .or('result.is.null,result.neq.void');

  if (error) throw error;
  return data;
}

async function getPendingPicks(playerId, weekNumber, seasonYear) {
  const { data, error } = await supabase
    .from('picks')
    .select('*')
    .eq('player_id', playerId)
    .eq('week_number', weekNumber)
    .eq('season_year', seasonYear)
    .eq('cancelled', false)
    .is('result', null)
    .gt('game_start_time', new Date().toISOString());

  if (error) throw error;
  return data;
}

async function cancelPick(pickId, playerId) {
  const { data: pick, error: fetchError } = await supabase
    .from('picks')
    .select('*')
    .eq('id', pickId)
    .eq('player_id', playerId)
    .single();

  if (fetchError || !pick) throw new Error('Pick not found or does not belong to player.');
  if (pick.game_start_time <= new Date().toISOString()) throw new Error('Game has already started. Pick cannot be cancelled.');
  if (pick.cancelled) throw new Error('Pick is already cancelled.');

  const { error: updateError } = await supabase
    .from('picks')
    .update({ cancelled: true })
    .eq('id', pickId);

  if (updateError) throw updateError;
}

async function submitPick(playerId, weekNumber, seasonYear, gameId, teamPicked, pickType, gameStartTime, odds, spreadPoint = null, homeTeam = null, awayTeam = null) {
  const { data, error } = await supabase
    .from('picks')
    .insert({
      player_id: playerId,
      week_number: weekNumber,
      season_year: seasonYear,
      game_id: gameId,
      team_picked: teamPicked,
      pick_type: pickType,
      game_start_time: gameStartTime,
      odds_at_lock: odds,
      spread_point: spreadPoint,
      home_team: homeTeam,
      away_team: awayTeam,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

const HALF_CUTOFF = new Date('2026-07-14'); // midnight UTC, safely inside the All-Star break dead zone (last 1H games July 12, 2H resumes July 17)

async function getLongShotWinnerForHalf(half) {
  let query = supabase
    .from('picks')
    .select('player_id, team_picked, odds_at_lock, points_awarded, players(discord_id, discord_username)')
    .eq('result', 'win')
    .eq('cancelled', false)
    .not('odds_at_lock', 'is', null)
    .order('odds_at_lock', { ascending: false })
    .limit(1);

  if (half === 'first') {
    query = query.lt('game_start_time', HALF_CUTOFF.toISOString());
  } else {
    query = query.gte('game_start_time', HALF_CUTOFF.toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}

async function getLongestShotLeader() {
  const now = new Date();
  return getLongShotWinnerForHalf(now < HALF_CUTOFF ? 'first' : 'second');
}

async function getFirstHalfChampion() {
  // Totalled in Postgres — reading every first-half pick here hit the
  // PostgREST 1000-row cap. get_half_totals returns one row per player.
  const [
    { data, error },
    { data: players, error: playersError },
  ] = await Promise.all([
    supabase.rpc('get_half_totals', {
      cutoff_start: '1970-01-01',
      cutoff_end: HALF_CUTOFF.toISOString(),
    }),
    supabase.from('players').select('id, discord_username'),
  ]);

  if (error) throw error;
  if (playersError) throw playersError;
  if (!data || data.length === 0) return null;

  const namesById = new Map((players || []).map(p => [p.id, p.discord_username]));
  const totals = {};
  for (const row of data) {
    const name = namesById.get(row.player_id) || 'Unknown';
    totals[name] = (totals[name] || 0) + Number(row.total_points || 0);
  }

  const max = Math.max(...Object.values(totals));
  const leaders = Object.keys(totals).filter(name => totals[name] === max);
  return { username: leaders.join(' & '), points: max };
}

module.exports = { getOrCreatePlayer, getPicksThisWeek, getPendingPicks, cancelPick, submitPick, getLongestShotLeader, getLongShotWinnerForHalf, getFirstHalfChampion, HALF_CUTOFF };

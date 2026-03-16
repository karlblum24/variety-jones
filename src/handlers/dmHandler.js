const { getMLBGames } = require('../services/oddsApi');
const { getOrCreatePlayer, getPicksThisWeek, getPendingPicks, cancelPick, submitPick } = require('../services/picks');
const { getPointsForResult, picksPerWeek } = require('../config/scoring');
const logger = require('../utils/logger');
const supabase = require('../database/supabase');

const IS_PRESEASON = process.env.IS_PRESEASON === 'true';

const conversationState = new Map();
const recentlyProcessed = new Set();

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

function formatEastern(isoString) {
  return new Date(isoString).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getMarketOdds(game, marketKey) {
  for (const bookmaker of game.bookmakers) {
    const market = bookmaker.markets.find(m => m.key === marketKey);
    if (market) return market;
  }
  return null;
}

function getTeamOdds(market, teamName) {
  if (!market) return null;
  const outcome = market.outcomes.find(o => o.name === teamName);
  return outcome ? outcome.price : null;
}

function buildGameListMessage(games, picksRemaining, isPreseason) {
  const header = `Hey there big boy! 👀\n\n` + (isPreseason
    ? `⚾ We're in preseason test mode! Make as many picks as you want. The scoreboard resets on Opening Day.\n\n`
    : `You have **${picksRemaining}** pick(s) remaining this week. Here are the upcoming games:\n\n`);

  const footer = `Reply with your pick(s) in this format: [Team Name] [moneyline or spread]\nExample: Yankees moneyline, Braves spread, Cubs ml (use a comma between picks)\nYou can submit up to ${picksRemaining} pick(s) this session.\n\n⚠️ **Important:** Your pick is not confirmed until you see a confirmation message from the bot. If you do not receive a confirmation, your pick was not saved.`;

  const gameBlocks = games.map((game, i) => {
    const h2h = getMarketOdds(game, 'h2h');
    const spreads = getMarketOdds(game, 'spreads');
    const awayML = getTeamOdds(h2h, game.away_team);
    const homeML = getTeamOdds(h2h, game.home_team);
    const awaySpread = spreads ? spreads.outcomes.find(o => o.name === game.away_team) : null;
    const homeSpread = spreads ? spreads.outcomes.find(o => o.name === game.home_team) : null;

    let block = `**${i + 1}.** ${game.away_team} @ ${game.home_team} | ${formatEastern(game.commence_time)} ET\n`;
    if (awayML !== null && homeML !== null) {
      block += `   ML: ${game.away_team} (${formatOdds(awayML)}) / ${game.home_team} (${formatOdds(homeML)})\n`;
    }
    if (awaySpread && homeSpread) {
      block += `   Spread: ${game.away_team} ${awaySpread.point} (${formatOdds(awaySpread.price)}) / ${game.home_team} ${homeSpread.point} (${formatOdds(homeSpread.price)})\n`;
    }
    block += '\n';
    return block;
  });

  const chunks = [];
  let current = header;

  for (const block of gameBlocks) {
    if (current.length + block.length > 1900) {
      chunks.push(current);
      current = block;
    } else {
      current += block;
    }
  }

  current += footer;
  chunks.push(current);

  return chunks;
}

function findTeamInGames(teamInput, games) {
  const input = teamInput.toLowerCase().trim();
  for (const game of games) {
    if (game.away_team.toLowerCase().includes(input) || input.includes(game.away_team.toLowerCase().split(' ').pop().toLowerCase())) {
      return { game, teamName: game.away_team };
    }
    if (game.home_team.toLowerCase().includes(input) || input.includes(game.home_team.toLowerCase().split(' ').pop().toLowerCase())) {
      return { game, teamName: game.home_team };
    }
  }
  return null;
}

function getOddsForPick(game, teamName, pickType) {
  const marketKey = pickType === 'moneyline' ? 'h2h' : 'spreads';
  const market = getMarketOdds(game, marketKey);
  if (!market) return null;
  const outcome = market.outcomes.find(o => o.name === teamName);
  return outcome ? outcome.price : null;
}

function getOpponent(game, teamName) {
  return game.home_team === teamName ? game.away_team : game.home_team;
}

async function handleStep0(message) {
  const userId = message.author.id;

  const games = await getMLBGames();

  if (games.length === 0) {
    await message.reply('There are no upcoming MLB games available right now. Check back later!');
    return;
  }

  const player = await getOrCreatePlayer(message.author.id, message.author.username);

  const now = new Date();
  const weekNumber = getISOWeek(now);
  const seasonYear = now.getFullYear();

  const picksThisWeek = await getPicksThisWeek(player.id, weekNumber, seasonYear);

  let picksRemaining;
  if (IS_PRESEASON) {
    picksRemaining = 999;
  } else {
    picksRemaining = picksPerWeek - picksThisWeek.length;
    if (picksRemaining <= 0) {
      await message.reply(`You've already used all ${picksPerWeek} picks for this week. Check back next week!`);
      return;
    }
  }

  // Exclude all games this player has picked this week, including cancelled ones (can't re-pick a cancelled game)
  const { data: allPickRows } = await supabase
    .from('picks')
    .select('game_id')
    .eq('player_id', player.id)
    .eq('week_number', weekNumber)
    .eq('season_year', seasonYear);

  const usedGameIds = new Set((allPickRows || []).map(p => p.game_id));
  const availableGames = games.filter(g => !usedGameIds.has(g.id));

  if (availableGames.length === 0) {
    await message.reply(`You've already made picks for all available games this week.`);
    return;
  }

  conversationState.set(userId, {
    step: 1,
    games: availableGames,
    player,
    weekNumber,
    seasonYear,
    picksRemaining,
    startedAt: Date.now(),
  });

  logger.info(userId, 'Step 0 complete, sending game list', { games: availableGames.length, picksRemaining });

  const chunks = buildGameListMessage(availableGames, picksRemaining, IS_PRESEASON);
  await message.reply(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    await message.author.send(chunks[i]);
  }
}

async function handleStep1(message, state) {
  const userId = message.author.id;
  const input = message.content.trim();
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);

  if (parts.length === 0) {
    await message.reply(`Please reply with your pick(s) in this format: [Team Name] [moneyline or spread]\nExample: Yankees moneyline or Braves spread, Cubs ml`);
    return;
  }

  if (parts.length > state.picksRemaining) {
    await message.reply(`You only have ${state.picksRemaining} pick(s) remaining this week. Please submit ${state.picksRemaining} or fewer picks.`);
    return;
  }

  const pendingPicks = [];
  const usedGameIds = new Set();

  for (const part of parts) {
    const words = part.trim().split(/\s+/);
    if (words.length < 2) {
      await message.reply(`Could not parse "${part}". Use the format: [Team Name] [moneyline or spread]`);
      return;
    }

    const pickTypeWord = words[words.length - 1].toLowerCase();
    let pickType;
    if (pickTypeWord === 'moneyline' || pickTypeWord === 'ml') {
      pickType = 'moneyline';
    } else if (pickTypeWord === 'spread' || pickTypeWord === 'runline' || pickTypeWord === 'rl') {
      pickType = 'spread';
    } else {
      await message.reply(`Pick type must be "moneyline", "ml", "spread", "runline", or "rl". Got "${pickTypeWord}" in: "${part}"`);
      return;
    }
    const teamInput = words.slice(0, -1).join(' ');

    const match = findTeamInGames(teamInput, state.games);
    if (!match) {
      await message.reply(`Could not find team "${teamInput}" in the available games. Check the team names and try again.`);
      return;
    }

    if (usedGameIds.has(match.game.id)) {
      await message.reply(`You already have a pick for ${match.game.away_team} @ ${match.game.home_team}. Only one pick per game.`);
      return;
    }
    usedGameIds.add(match.game.id);

    const odds = getOddsForPick(match.game, match.teamName, pickType);
    if (odds === null) {
      await message.reply(`Could not find ${pickType} odds for ${match.teamName}. Please try a different pick.`);
      return;
    }

    let point = null;
    if (pickType === 'spread') {
      const spreadMarket = getMarketOdds(match.game, 'spreads');
      if (spreadMarket) {
        const spreadOutcome = spreadMarket.outcomes.find(o => o.name === match.teamName);
        if (spreadOutcome) point = spreadOutcome.point;
      }
    }

    pendingPicks.push({
      game: match.game,
      teamName: match.teamName,
      pickType,
      odds,
      point,
    });
  }

  logger.info(userId, 'Step 1 picks parsed', { count: pendingPicks.length });

  let confirmMsg = `Here are your picks:\n\n`;
  pendingPicks.forEach((pick, i) => {
    const opponent = getOpponent(pick.game, pick.teamName);
    const win = getPointsForResult(pick.odds, 'win');
    const loss = getPointsForResult(pick.odds, 'loss');
    const pickLabel = pick.pickType === 'spread' && pick.point !== null ? `spread ${pick.point}` : pick.pickType;
    confirmMsg += `${i + 1}. **${pick.teamName}** (${pickLabel}) vs ${opponent} | ${formatEastern(pick.game.commence_time)} ET\n`;
    confirmMsg += `   Odds: ${formatOdds(pick.odds)} | Win: +${win} pts | Loss: ${loss} pts\n\n`;
  });
  confirmMsg += `Reply **YES** to confirm or anything else to start over.`;

  conversationState.set(userId, { ...state, step: 2, pendingPicks });

  await message.reply(confirmMsg);
}

async function handleStep2(message, state) {
  const userId = message.author.id;

  if (message.content.trim().toUpperCase() === 'YES') {
    for (const pick of state.pendingPicks) {
      try {
        await submitPick(
          state.player.id,
          state.weekNumber,
          state.seasonYear,
          pick.game.id,
          pick.teamName,
          pick.pickType,
          pick.game.commence_time,
          pick.odds
        );
      } catch (err) {
        logger.error(userId, `submitPick failed for ${pick.teamName}`, err);
        await message.reply(`There was an error saving your pick for ${pick.teamName}. Please try again.`);
        conversationState.delete(userId);
        return;
      }
    }

    logger.info(userId, 'Picks confirmed and saved', { count: state.pendingPicks.length });
    conversationState.delete(userId);
    await message.reply(
      `✅ **Picks confirmed and saved!**\nYour picks are locked in. Your odds were locked at submission time. I'll DM you when each game starts as a reminder.\n\n⚠️ If you did not receive this message, your pick was not saved. DM the bot again to resubmit.\n\nnow be a good boy and make all your picks for daddy this week 😈`
    );
  } else {
    await message.reply(`No picks confirmed. Let's start over.`);
    conversationState.delete(userId);
    await handleStep0(message);
  }
}


async function handleCancelPick(message) {
  const now = new Date();
  const weekNumber = getISOWeek(now);
  const seasonYear = now.getFullYear();
  const userId = message.author.id;

  const player = await getOrCreatePlayer(userId, message.author.username);
  const pendingPicks = await getPendingPicks(player.id, weekNumber, seasonYear);

  if (pendingPicks.length === 0) {
    await message.reply('You have no pending picks to cancel.');
    return;
  }

  let msg = `Which pick would you like to cancel?\n\n`;
  pendingPicks.forEach((pick, i) => {
    const oddsStr = pick.odds_at_lock !== null ? formatOdds(pick.odds_at_lock) : 'N/A';
    msg += `${i + 1}. **${pick.team_picked}** (${pick.pick_type}) | Odds: ${oddsStr} | ${formatEastern(pick.game_start_time)} ET\n`;
  });
  msg += `\nReply with the number of the pick you want to cancel.`;

  conversationState.set(userId, {
    step: 'cancel_confirm',
    pendingPicks,
    player,
    weekNumber,
    seasonYear,
    startedAt: Date.now(),
  });

  await message.reply(msg);
}

async function handleCancelConfirm(message, state) {
  const userId = message.author.id;
  const n = parseInt(message.content.trim(), 10);

  if (isNaN(n) || n < 1 || n > state.pendingPicks.length) {
    await message.reply(`Please reply with a number between 1 and ${state.pendingPicks.length}.`);
    return;
  }

  const pick = state.pendingPicks[n - 1];
  const oddsStr = pick.odds_at_lock !== null ? formatOdds(pick.odds_at_lock) : 'N/A';

  const msg =
    `You selected: **${pick.team_picked}** (${pick.pick_type}) | Odds: ${oddsStr} | ${formatEastern(pick.game_start_time)} ET\n\n` +
    `⚠️ If you cancel this pick, you will get your pick slot back BUT you cannot use this game again this week.\n\n` +
    `Type **YES** to confirm or anything else to go back.`;

  conversationState.set(userId, { ...state, step: 'cancel_final', selectedPick: pick });

  await message.reply(msg);
}

async function handleCancelFinal(message, state) {
  const userId = message.author.id;

  if (message.content.trim().toUpperCase() === 'YES') {
    try {
      await cancelPick(state.selectedPick.id, state.player.id);
    } catch (err) {
      logger.error(userId, 'cancelPick failed', err);
      await message.reply(`Could not cancel pick: ${err.message}`);
      conversationState.delete(userId);
      return;
    }
    logger.info(userId, 'Pick cancelled', { pickId: state.selectedPick.id });
    conversationState.delete(userId);
    await message.reply(`✅ Pick cancelled. You have your pick slot back — but remember, you cannot pick this game again this week.`);
  } else {
    conversationState.delete(userId);
    await message.reply(`Cancelled. No changes made.`);
  }
}

async function handleShowPicks(message) {
  const now = new Date();
  const weekNumber = getISOWeek(now);
  const seasonYear = now.getFullYear();
  const nowIso = now.toISOString();
  const userId = message.author.id;

  const player = await getOrCreatePlayer(userId, message.author.username);
  const picks = await getPicksThisWeek(player.id, weekNumber, seasonYear);

  if (picks.length === 0) {
    await message.reply("You have no picks this week yet. DM me anything to get started!");
    return;
  }

  const pending = picks.filter(p => p.game_start_time > nowIso && p.result === null);
  const locked = picks.filter(p => p.game_start_time <= nowIso && p.result === null);
  const completed = picks.filter(p => p.result !== null);

  const blocks = [];

  if (pending.length > 0) {
    let section = `⏳ **Pending Picks**\n`;
    for (const p of pending) {
      const odds = p.odds_at_lock;
      const win = odds !== null ? getPointsForResult(odds, 'win') : '?';
      const loss = odds !== null ? getPointsForResult(odds, 'loss') : '?';
      const oddsStr = odds !== null ? formatOdds(odds) : 'N/A';
      section += `• **${p.team_picked}** (${p.pick_type}) | Odds: ${oddsStr} | Win: +${win} pts | Loss: ${loss} pts | ${formatEastern(p.game_start_time)} ET\n`;
    }
    blocks.push(section);
  }

  if (locked.length > 0) {
    let section = `🔒 **Locked Picks**\n`;
    for (const p of locked) {
      const odds = p.odds_at_lock;
      const win = odds !== null ? getPointsForResult(odds, 'win') : '?';
      const loss = odds !== null ? getPointsForResult(odds, 'loss') : '?';
      const oddsStr = odds !== null ? formatOdds(odds) : 'N/A';
      section += `• **${p.team_picked}** (${p.pick_type}) | Odds: ${oddsStr} | Win: +${win} pts | Loss: ${loss} pts\n`;
    }
    blocks.push(section);
  }

  if (completed.length > 0) {
    let section = `✅ **Completed Picks**\n`;
    for (const p of completed) {
      const odds = p.odds_at_lock;
      const oddsStr = odds !== null ? formatOdds(odds) : 'N/A';
      section += `• **${p.team_picked}** (${p.pick_type}) | Odds: ${oddsStr} | Result: ${p.result} | Points: ${p.points_awarded ?? 0}\n`;
    }
    blocks.push(section);
  }

  const picksRemaining = IS_PRESEASON ? 'unlimited' : Math.max(0, picksPerWeek - picks.length);
  const footer = `\nPicks remaining this week: **${picksRemaining}**`;

  const chunks = [];
  let current = '';

  for (const block of blocks) {
    if (current.length + block.length > 1900) {
      chunks.push(current);
      current = block;
    } else {
      current += (current ? '\n' : '') + block;
    }
  }
  current += footer;
  chunks.push(current);

  await message.reply(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    await message.author.send(chunks[i]);
  }
}

async function handleDM(message) {
  if (recentlyProcessed.has(message.id)) return;
  recentlyProcessed.add(message.id);
  setTimeout(() => recentlyProcessed.delete(message.id), 5000);

  const userId = message.author.id;
  const input = message.content.trim().toLowerCase();

  logger.info(userId, 'DM received', { input });

  try {
    const SHOW_PICKS_PHRASES = ['my picks', 'show my picks', 'show picks', 'show me picks', 'my pick', 'see my picks', 'view picks'];
    if (SHOW_PICKS_PHRASES.some(phrase => input.includes(phrase))) {
      await handleShowPicks(message);
      return;
    }

    if (input === 'cancel' || input.startsWith('cancel pick') || input.startsWith('cancel my')) {
      conversationState.delete(userId);
      await handleCancelPick(message);
      return;
    }

    const state = conversationState.get(userId);

    if (!state) {
      await handleStep0(message);
      return;
    }

    if (Date.now() - state.startedAt > 3 * 60 * 1000) {
      conversationState.delete(userId);
      await handleStep0(message);
      return;
    }

    if (state.step === 1) {
      await handleStep1(message, state);
    } else if (state.step === 2) {
      await handleStep2(message, state);
    } else if (state.step === 'cancel_confirm') {
      await handleCancelConfirm(message, state);
    } else if (state.step === 'cancel_final') {
      await handleCancelFinal(message, state);
    } else {
      conversationState.delete(userId);
      await handleStep0(message);
    }
  } catch (err) {
    logger.error(userId, 'Unhandled error in handleDM', err);
    conversationState.delete(userId);
    try { await message.reply('Something went wrong. Please try again.'); } catch (_) {}
  }
}

module.exports = { handleDM };

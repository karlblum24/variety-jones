const { getMLBGames } = require('../services/oddsApi');
const { getOrCreatePlayer, getPicksThisWeek, submitPick } = require('../services/picks');
const { getPointsForResult, picksPerWeek } = require('../config/scoring');

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
  let msg = isPreseason
    ? `⚾ We're in preseason test mode! Make as many picks as you want. The scoreboard resets on Opening Day.\n\n`
    : `You have **${picksRemaining}** pick(s) remaining this week. Here are the upcoming games:\n\n`;

  games.forEach((game, i) => {
    const h2h = getMarketOdds(game, 'h2h');
    const spreads = getMarketOdds(game, 'spreads');
    const awayML = getTeamOdds(h2h, game.away_team);
    const homeML = getTeamOdds(h2h, game.home_team);
    const awaySpread = spreads ? spreads.outcomes.find(o => o.name === game.away_team) : null;
    const homeSpread = spreads ? spreads.outcomes.find(o => o.name === game.home_team) : null;

    msg += `**${i + 1}.** ${game.away_team} @ ${game.home_team} | ${formatEastern(game.commence_time)} ET\n`;
    if (awayML !== null && homeML !== null) {
      msg += `   ML: ${game.away_team} (${formatOdds(awayML)}) / ${game.home_team} (${formatOdds(homeML)})\n`;
    }
    if (awaySpread && homeSpread) {
      msg += `   Spread: ${game.away_team} (${formatOdds(awaySpread.price)}) / ${game.home_team} (${formatOdds(homeSpread.price)})\n`;
    }
    msg += '\n';
  });

  msg += `Reply with your game number(s) (e.g. 1 or 1,2,3)`;
  return msg;
}

function buildPickOptionsMessage(selectedGames) {
  let msg = '';

  selectedGames.forEach(game => {
    const h2h = getMarketOdds(game, 'h2h');
    const spreads = getMarketOdds(game, 'spreads');
    const awayML = getTeamOdds(h2h, game.away_team);
    const homeML = getTeamOdds(h2h, game.home_team);
    const awaySpreadOutcome = spreads ? spreads.outcomes.find(o => o.name === game.away_team) : null;
    const homeSpreadOutcome = spreads ? spreads.outcomes.find(o => o.name === game.home_team) : null;

    msg += `**Game:** ${game.away_team} @ ${game.home_team}\n`;
    msg += `Your pick options:\n`;

    if (awayML !== null) {
      const win = getPointsForResult(awayML, 'win');
      const loss = getPointsForResult(awayML, 'loss');
      msg += `- ${game.away_team} ML (${formatOdds(awayML)}) → could earn ${win} pts if win / ${loss} pts if loss\n`;
    }
    if (homeML !== null) {
      const win = getPointsForResult(homeML, 'win');
      const loss = getPointsForResult(homeML, 'loss');
      msg += `- ${game.home_team} ML (${formatOdds(homeML)}) → could earn ${win} pts if win / ${loss} pts if loss\n`;
    }
    if (awaySpreadOutcome) {
      const win = getPointsForResult(awaySpreadOutcome.price, 'win');
      const loss = getPointsForResult(awaySpreadOutcome.price, 'loss');
      msg += `- ${game.away_team} Spread (${formatOdds(awaySpreadOutcome.price)}) → could earn ${win} pts if win / ${loss} pts if loss\n`;
    }
    if (homeSpreadOutcome) {
      const win = getPointsForResult(homeSpreadOutcome.price, 'win');
      const loss = getPointsForResult(homeSpreadOutcome.price, 'loss');
      msg += `- ${game.home_team} Spread (${formatOdds(homeSpreadOutcome.price)}) → could earn ${win} pts if win / ${loss} pts if loss\n`;
    }
    msg += '\n';
  });

  msg += `Reply with your pick(s) in this format: [Team Name] [moneyline or spread]\nExample: Yankees moneyline, Red Sox spread`;
  return msg;
}

function findTeamInGames(teamInput, selectedGames) {
  const input = teamInput.toLowerCase().trim();
  for (const game of selectedGames) {
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

  let games, player, picksThisWeek;
  try {
    games = await getMLBGames();
  } catch (err) {
    await message.reply('Sorry, I could not fetch today\'s games. Please try again later.');
    return;
  }

  if (games.length === 0) {
    await message.reply('There are no upcoming MLB games available right now. Check back later!');
    return;
  }

  try {
    player = await getOrCreatePlayer(message.author.id, message.author.username);
  } catch (err) {
    await message.reply('Sorry, there was an error loading your account. Please try again later.');
    return;
  }

  const now = new Date();
  const weekNumber = getISOWeek(now);
  const seasonYear = now.getFullYear();

  try {
    picksThisWeek = await getPicksThisWeek(player.id, weekNumber, seasonYear);
  } catch (err) {
    await message.reply('Sorry, there was an error loading your picks. Please try again later.');
    return;
  }

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

  const pickedGameIds = new Set(picksThisWeek.map(p => p.game_id));
  const availableGames = games.filter(g => !pickedGameIds.has(g.id));

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

  await message.reply(buildGameListMessage(availableGames, picksRemaining, IS_PRESEASON));
}

async function handleStep1(message, state) {
  const userId = message.author.id;
  const input = message.content.trim();
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);

  const numbers = [];
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 1 || n > state.games.length) {
      await message.reply(`"${part}" is not a valid game number. Please reply with numbers between 1 and ${state.games.length} (e.g. 1 or 1,2,3).`);
      return;
    }
    numbers.push(n);
  }

  if (numbers.length === 0) {
    await message.reply(`Please reply with one or more game numbers (e.g. 1 or 1,2,3).`);
    return;
  }

  if (numbers.length > state.picksRemaining) {
    await message.reply(`You only have ${state.picksRemaining} pick(s) remaining this week. Please choose ${state.picksRemaining} or fewer games.`);
    return;
  }

  const selectedGames = numbers.map(n => state.games[n - 1]);

  conversationState.set(userId, { ...state, step: 2, selectedGames });

  await message.reply(buildPickOptionsMessage(selectedGames));
}

async function handleStep2(message, state) {
  const userId = message.author.id;
  const input = message.content.trim();
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);

  if (parts.length !== state.selectedGames.length) {
    await message.reply(
      `You selected ${state.selectedGames.length} game(s), so please submit ${state.selectedGames.length} pick(s).\n` +
      `Format: [Team Name] [moneyline or spread]\nExample: Yankees moneyline, Red Sox spread`
    );
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

    const match = findTeamInGames(teamInput, state.selectedGames);
    if (!match) {
      await message.reply(`Could not find team "${teamInput}" in your selected games. Check the team names and try again.`);
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

    pendingPicks.push({
      game: match.game,
      teamName: match.teamName,
      pickType,
      odds,
    });
  }

  let confirmMsg = `Here are your picks:\n\n`;
  pendingPicks.forEach((pick, i) => {
    const opponent = getOpponent(pick.game, pick.teamName);
    const win = getPointsForResult(pick.odds, 'win');
    const loss = getPointsForResult(pick.odds, 'loss');
    confirmMsg += `${i + 1}. **${pick.teamName}** (${pick.pickType}) vs ${opponent} | ${formatEastern(pick.game.commence_time)} ET\n`;
    confirmMsg += `   Odds: ${formatOdds(pick.odds)} | Win: +${win} pts | Loss: ${loss} pts\n\n`;
  });
  confirmMsg += `Reply **YES** to confirm or anything else to start over.`;

  conversationState.set(userId, { ...state, step: 3, pendingPicks });

  await message.reply(confirmMsg);
}

async function handleStep3(message, state) {
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
          pick.game.commence_time
        );
      } catch (err) {
        await message.reply(`There was an error saving your pick for ${pick.teamName}. Please try again.`);
        conversationState.delete(userId);
        return;
      }
    }

    conversationState.delete(userId);
    await message.reply(
      `Your picks are locked in! I'll DM you when each game starts to confirm the closing line and your scoring opportunity.`
    );
  } else {
    await message.reply(`No picks confirmed. Let's start over.`);
    conversationState.delete(userId);
    await handleStep0(message);
  }
}

async function handleDM(message) {
  if (recentlyProcessed.has(message.id)) return;
  recentlyProcessed.add(message.id);
  setTimeout(() => recentlyProcessed.delete(message.id), 5000);

  const userId = message.author.id;
  const state = conversationState.get(userId);

  if (!state) {
    await handleStep0(message);
    return;
  }

  if (Date.now() - state.startedAt > 10 * 60 * 1000) {
    conversationState.delete(userId);
    await handleStep0(message);
    return;
  }

  if (state.step === 1) {
    await handleStep1(message, state);
  } else if (state.step === 2) {
    await handleStep2(message, state);
  } else if (state.step === 3) {
    await handleStep3(message, state);
  } else {
    conversationState.delete(userId);
    await handleStep0(message);
  }
}

module.exports = { handleDM };

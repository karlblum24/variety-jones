const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let cachedGames = null;
let cacheTimestamp = null;

async function getMLBGames() {
  // Return cached response if still fresh
  if (cachedGames && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL_MS)) {
    console.log(`[oddsApi] Returning cached games (${cachedGames.length} games, cached ${Math.round((Date.now() - cacheTimestamp) / 1000)}s ago)`);
    return cachedGames;
  }

  const params = new URLSearchParams({
    apiKey: process.env.ODDS_API_KEY,
    regions: 'us',
    markets: 'h2h,spreads',
    oddsFormat: 'american',
  });

  const endpoints = [
    `${ODDS_API_BASE}/sports/baseball_mlb/odds?${params}`,
    `${ODDS_API_BASE}/sports/baseball_mlb_preseason/odds?${params}`,
  ];

  const results = await Promise.all(
    endpoints.map(async url => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Odds API error: ${res.status}`);
        return res.json();
      } catch (err) {
        console.error(`[oddsApi] Failed to fetch ${url}:`, err.message);
        return [];
      }
    })
  );

  const now = new Date();
  const games = results
    .flat()
    .filter(g => new Date(g.commence_time) > now)
    .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

  // Update cache
  cachedGames = games;
  cacheTimestamp = Date.now();
  console.log(`[oddsApi] Fetched and cached ${games.length} games from API`);

  return games;
}

function clearOddsCache() {
  cachedGames = null;
  cacheTimestamp = null;
  console.log('[oddsApi] Odds cache cleared');
}

module.exports = { getMLBGames, clearOddsCache };

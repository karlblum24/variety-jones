const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

async function getMLBGames() {
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
  return results
    .flat()
    .filter(g => new Date(g.commence_time) > now)
    .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
}

module.exports = { getMLBGames };

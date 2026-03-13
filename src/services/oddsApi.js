const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

async function getMLBGames() {
  const params = new URLSearchParams({
    apiKey: process.env.ODDS_API_KEY,
    regions: 'us',
    markets: 'h2h,spreads',
    oddsFormat: 'american',
  });

  const res = await fetch(`${ODDS_API_BASE}/sports/baseball_mlb/odds?${params}`);
  if (!res.ok) throw new Error(`Odds API error: ${res.status}`);

  const games = await res.json();
  const now = new Date();
  return games.filter(g => new Date(g.commence_time) > now);
}

module.exports = { getMLBGames };

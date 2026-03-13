/**
 * Scoring configuration.
 * Edit the tiers array to adjust point values — no logic changes needed.
 */

const picksPerWeek = 3;

// Tiers are evaluated top to bottom. First match wins.
const tiers = [
  { maxOdds: -250, win: 0.5,  loss: -0.5 },
  { maxOdds: -200, win: 1.0,  loss: -0.5 },
  { maxOdds: -150, win: 1.5,  loss: 0    },
  { maxOdds:  100, win: 2.0,  loss: 0    },
  { maxOdds:  150, win: 2.5,  loss: 0    },
  { maxOdds:  199, win: 3.0,  loss: 0    },
  { maxOdds:  299, win: 3.5,  loss: 0    },
  { maxOdds: Infinity, win: 4.0, loss: 0 },
];

/**
 * Returns the points awarded for a pick.
 * @param {number} odds - American odds integer (e.g. -150, +220)
 * @param {'win'|'loss'|'push'} result
 * @returns {number}
 */
function getPointsForResult(odds, result) {
  if (result === 'push') return 0;

  const tier = tiers.find(t => odds <= t.maxOdds);
  if (!tier) return 0;

  return result === 'win' ? tier.win : tier.loss;
}

module.exports = { picksPerWeek, tiers, getPointsForResult };
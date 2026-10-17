// House edge with perfect basic strategy, as a fraction of the initial bet.
// Built from standard published rule-effect estimates, starting from a
// single-deck game where the dealer stands on soft 17, no double after split,
// double on any two cards, split to 4 hands, no resplitting aces, no surrender
// and 3:2 blackjack (roughly break-even).
const DECK_EFFECT = { 1: 0, 2: 0.0035, 4: 0.0052, 6: 0.0058, 8: 0.0061 };

export function houseEdge(rules) {
  let edge = -0.0003;
  edge += DECK_EFFECT[rules.decks] ?? 0.0058;
  if (rules.h17) edge += rules.decks === 1 ? 0.0018 : 0.0022;
  if (rules.das) edge -= 0.0014;
  if (rules.doubleOn === '9-11') edge += 0.0009;
  if (rules.doubleOn === '10-11') edge += 0.0018;
  if (rules.resplitAces) edge -= 0.0008;
  if (rules.surrender) edge -= rules.h17 ? 0.0009 : 0.0008;
  if (rules.maxHands === 2) edge += 0.0003;
  if (rules.maxHands === 3) edge += 0.0001;
  if (rules.blackjackPays === '6:5') edge += 0.0139;
  return edge;
}

// Per-hand standard deviation of blackjack results, in units of the initial
// bet, and the correlation between two hands played against the same dealer.
export const HAND_SD = 1.15;
export const SEAT_CORRELATION = 0.48;

// Variance of one round in dollars² from the stakes alone.
export function roundVariance(wagers) {
  let v = 0;
  for (let i = 0; i < wagers.length; i++) {
    for (let j = 0; j < wagers.length; j++) {
      const rho = i === j ? 1 : SEAT_CORRELATION;
      v += rho * HAND_SD * HAND_SD * wagers[i] * wagers[j];
    }
  }
  return v;
}

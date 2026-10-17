// Basic strategy engine. Tables follow standard total-dependent basic strategy
// for American-style games (dealer peeks for blackjack), adjusted for the
// configured rules: number of decks, H17/S17, double after split, doubling
// restrictions, late surrender and resplitting aces.

export const DEFAULT_RULES = {
  decks: 6,
  h17: false, // dealer hits soft 17
  das: true, // double after split
  doubleOn: 'any', // 'any' | '9-11' | '10-11'
  surrender: false, // late surrender
  resplitAces: false,
  maxHands: 4, // max hands after splitting
  blackjackPays: '3:2', // '3:2' | '6:5'
};

export const ACTION_NAMES = {
  H: 'Hit',
  S: 'Stand',
  D: 'Double',
  P: 'Split',
  R: 'Surrender',
};

// Card helpers. A card is { rank: 'A'|'2'..'10'|'J'|'Q'|'K', suit }.
export function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  return Number(card.rank);
}

export function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export function isPair(cards) {
  return cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
}

export function isBlackjack(cards) {
  return cards.length === 2 && handTotal(cards).total === 21;
}

function deckGroup(rules) {
  if (rules.decks <= 1) return 1;
  if (rules.decks === 2) return 2;
  return 4;
}

const between = (up, lo, hi) => up >= lo && up <= hi;

// Raw codes: H, S, D (double else hit), Ds (double else stand), P (split),
// Rh / Rs / Rp (surrender, else hit / stand / split).

export function hardCode(total, up, rules) {
  const d = deckGroup(rules);
  const h17 = rules.h17;

  if (rules.surrender) {
    if (total === 17 && up === 11 && h17) return 'Rs';
    if (total === 16) {
      if (up === 10 || up === 11) return 'Rh';
      if (up === 9 && (d === 4 || (d === 2 && h17))) return 'Rh';
    }
    if (total === 15 && (up === 10 || (up === 11 && h17))) return 'Rh';
  }

  if (total <= 7) return 'H';
  if (total === 8) return d === 1 && between(up, 5, 6) ? 'D' : 'H';
  if (total === 9) return between(up, d === 4 ? 3 : 2, 6) ? 'D' : 'H';
  if (total === 10) return up <= 9 ? 'D' : 'H';
  if (total === 11) {
    if (up === 11) return h17 || d <= 2 ? 'D' : 'H';
    return 'D';
  }
  if (total === 12) return between(up, 4, 6) ? 'S' : 'H';
  if (total <= 16) return up <= 6 ? 'S' : 'H';
  return 'S';
}

// total is the soft total, e.g. A,7 = 18.
export function softCode(total, up, rules) {
  const d = deckGroup(rules);
  const h17 = rules.h17;

  if (total <= 12) return 'H'; // A,A when it cannot be split
  if (total <= 14) return between(up, d === 1 ? 4 : 5, 6) ? 'D' : 'H';
  if (total <= 16) return between(up, 4, 6) ? 'D' : 'H';
  if (total === 17) return between(up, d === 1 ? 2 : 3, 6) ? 'D' : 'H';
  if (total === 18) {
    if (between(up, h17 ? 2 : 3, 6)) return 'Ds';
    if (up <= 8) return 'S';
    if (up === 11 && d === 1 && !h17) return 'S';
    return 'H';
  }
  if (total === 19) return up === 6 && (h17 || d === 1) ? 'Ds' : 'S';
  return 'S';
}

// Returns a code for the pair, or null when the pair should be played as its
// hard/soft total.
export function pairCode(value, up, rules) {
  const d = deckGroup(rules);
  const das = rules.das;

  switch (value) {
    case 2:
      if (das) return between(up, 2, 7) ? 'P' : null;
      return between(up, d === 4 ? 4 : 3, 7) ? 'P' : null;
    case 3:
      if (das) return between(up, 2, d === 1 ? 8 : 7) ? 'P' : null;
      return between(up, 4, 7) ? 'P' : null;
    case 4:
      if (das) return between(up, d === 1 ? 4 : 5, 6) ? 'P' : null;
      return null;
    case 5:
      return null;
    case 6:
      if (das) return between(up, 2, d === 1 ? 7 : 6) ? 'P' : null;
      return between(up, d === 1 ? 2 : 3, 6) ? 'P' : null;
    case 7:
      if (d === 1) {
        if (between(up, 2, das ? 8 : 7)) return 'P';
        if (up === 10) return rules.surrender ? 'Rs' : 'S';
        return null;
      }
      return between(up, 2, 7) ? 'P' : null;
    case 8:
      if (up === 11 && rules.surrender && rules.h17 && d === 4) return 'Rp';
      return 'P';
    case 9:
      return between(up, 2, 6) || up === 8 || up === 9 ? 'P' : 'S';
    case 10:
      return 'S';
    case 11:
      return 'P';
  }
  return null;
}

// What the hand looks like for strategy purposes, e.g. "Hard 16", "Soft 18", "Pair of 8s".
export function describeHand(cards, considerPair = true) {
  if (considerPair && isPair(cards)) {
    const v = cardValue(cards[0]);
    return `Pair of ${v === 11 ? 'Aces' : v === 10 ? '10s' : v + 's'}`;
  }
  const { total, soft } = handTotal(cards);
  return `${soft ? 'Soft' : 'Hard'} ${total}`;
}

// Raw strategy code for a hand, ignoring what is currently allowed.
export function strategyCode(cards, up, rules, { canSplit = true } = {}) {
  if (isPair(cards) && canSplit) {
    const code = pairCode(cardValue(cards[0]), up, rules);
    if (code) return code;
  }
  const { total, soft } = handTotal(cards);
  return soft ? softCode(total, up, rules) : hardCode(total, up, rules);
}

// Whether a double is allowed for this hand total under the doubling rule.
export function doubleAllowedForTotal(cards, rules) {
  if (rules.doubleOn === 'any') return true;
  const { total, soft } = handTotal(cards);
  if (soft) return false;
  if (rules.doubleOn === '9-11') return total >= 9 && total <= 11;
  if (rules.doubleOn === '10-11') return total >= 10 && total <= 11;
  return true;
}

// Correct action letter (H, S, D, P, R) given the hand, the dealer's upcard
// value (2-11) and which actions are currently available.
export function correctAction(cards, up, rules, available) {
  const { canDouble, canSplit, canSurrender } = available;
  let code = strategyCode(cards, up, rules, { canSplit });

  if (code === 'Rp') code = canSurrender ? 'R' : canSplit ? 'P' : null;
  if (code === null || (code === 'P' && !canSplit)) {
    code = strategyCode(cards, up, rules, { canSplit: false });
  }
  switch (code) {
    case 'D':
      return canDouble ? 'D' : 'H';
    case 'Ds':
      return canDouble ? 'D' : 'S';
    case 'Rh':
      return canSurrender ? 'R' : 'H';
    case 'Rs':
      return canSurrender ? 'R' : 'S';
    default:
      return code;
  }
}

// Chart rows for display: { ups, hard, soft, pairs }, each row { label, cells }
// with one code per dealer upcard 2..11. Doubles the doubling rule forbids are
// shown as their fallback.
export function buildChart(rules) {
  const ups = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const row = (label, cards) => ({
    label,
    cells: ups.map((up) => {
      const code = strategyCode(cards, up, rules);
      if (!doubleAllowedForTotal(cards, rules)) {
        if (code === 'D') return 'H';
        if (code === 'Ds') return 'S';
      }
      return code;
    }),
  });
  const card = (v) => ({ rank: v === 11 ? 'A' : String(v) });

  const hard = [];
  for (let t = 17; t >= 5; t--) {
    // Two different non-ace cards making the total, so it is never a pair.
    const a = t >= 12 ? 10 : t - 2 === 2 ? 3 : 2;
    hard.push(row(t === 17 ? '17+' : String(t), [card(a), card(t - a)]));
  }
  const soft = [];
  for (let t = 20; t >= 13; t--) soft.push(row(`A,${t - 11}`, [card(11), card(t - 11)]));
  const pairs = [];
  for (const v of [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) {
    const n = v === 11 ? 'A' : String(v);
    pairs.push(row(`${n},${n}`, [card(v), card(v)]));
  }
  return { ups, hard, soft, pairs };
}

// All-time mistake log and the ranked summary built from it. Each entry is
// { id, hand, t, situation, chose, book, cost, stake }, where `hand` is the
// all-time hand number it happened on (0 for mistakes logged before hand
// numbers existed). Groups are by situation, action taken and book action.

const VERBS = { H: 'Hit', S: 'Stood on', D: 'Doubled', P: 'Split', R: 'Surrendered' };

export function mistakeKey(m) {
  return `${m.situation}|${m.chose}|${m.book}`;
}

// Entries from the last `lastHands` hands (all entries when lastHands is null).
export function recentMistakes(log, handCount, lastHands) {
  if (lastHands == null) return log;
  const from = handCount - lastHands;
  return log.filter((m) => m.hand > from);
}

// Groups ranked by 'impact' (average EV lost per hand, as a fraction of the
// bet), 'count' or 'cost' (total dollars), most costly first. Each group keeps
// its entries, newest first.
export function rankMistakes(entries, by = 'impact') {
  const groups = new Map();
  for (const m of entries) {
    const key = mistakeKey(m);
    if (!groups.has(key)) {
      groups.set(key, { key, situation: m.situation, chose: m.chose, book: m.book, count: 0, cost: 0, units: 0, entries: [] });
    }
    const g = groups.get(key);
    g.count += 1;
    g.cost += m.cost;
    g.units += m.stake > 0 ? m.cost / m.stake : 0;
    g.entries.push(m);
  }
  const rows = [...groups.values()].map((g) => ({
    ...g,
    entries: g.entries.sort((a, b) => (b.hand - a.hand) || ((b.t ?? 0) - (a.t ?? 0))),
    perHand: g.units / g.count,
    label: `${VERBS[g.chose]} ${g.situation.charAt(0).toLowerCase()}${g.situation.slice(1)}`,
  }));
  const key = { impact: 'perHand', count: 'count', cost: 'cost' }[by] ?? 'perHand';
  return rows.sort((a, b) => b[key] - a[key] || b.cost - a.cost);
}

// Card values (2-11, ace = 11) for a hand matching a situation's type and
// total: two different values when possible (so it is not a pair), otherwise
// three cards.
function handValues(kind, total, rng) {
  const options = [];
  if (kind === 'soft') {
    if (total >= 13 && total <= 20) options.push([11, total - 11]);
    else for (let a = 2; a <= 9; a++) if (total - 11 - a >= 2 && total - 11 - a <= 9) options.push([11, a, total - 11 - a]);
  } else {
    for (let a = 2; a <= 10; a++) {
      const b = total - a;
      if (b > a && b <= 10) options.push([a, b]);
    }
    if (!options.length) {
      for (let a = 2; a <= 10; a++) {
        for (let b = 2; b <= 10; b++) {
          const c = total - a - b;
          // No ace and no soft total: the first two must not make 21 either.
          if (c >= 2 && c <= 10 && a + b < 21) options.push([a, b, c]);
        }
      }
    }
    // Hard 4 only comes as 2,2 (it was a pair that could not be split).
    if (!options.length && total % 2 === 0 && total / 2 >= 2 && total / 2 <= 10) options.push([total / 2, total / 2]);
  }
  if (!options.length) return null;
  const pick = options[Math.floor(rng() * options.length)];
  return rng() < 0.5 && pick.length === 2 ? [pick[1], pick[0]] : pick;
}

const UP = { A: 11 };

// Parses "Hard 12 vs dealer 3", "Soft 18 vs dealer A" or "Pair of 8s vs
// dealer 10" into { hand: [card values], up }. Returns null if it cannot.
export function situationHand(situation, rng = Math.random) {
  let m = /^(Hard|Soft) (\d+) vs dealer (\w+)$/.exec(situation);
  if (m) {
    const up = UP[m[3]] ?? Number(m[3]);
    const hand = handValues(m[1].toLowerCase(), Number(m[2]), rng);
    return hand && up ? { hand, up } : null;
  }
  m = /^Pair of (Aces|\d+)s? vs dealer (\w+)$/.exec(situation);
  if (m) {
    const v = m[1] === 'Aces' ? 11 : Number(m[1]);
    const up = UP[m[2]] ?? Number(m[2]);
    return v && up ? { hand: [v, v], up } : null;
  }
  return null;
}

// Picks a round of situations for the mistakes drill, weighted by the EV each
// mistake group has cost (frequency × cost per hand). All seats share the
// first pick's dealer upcard, using other mistakes with that upcard when there
// are any. Returns { hands, up } or null when there is nothing to drill.
export function mistakeScenario(log, seats, rng = Math.random) {
  const groups = rankMistakes(log)
    .map((g) => ({ g, weight: Math.max(g.units, 0.001), parsed: situationHand(g.situation, rng) }))
    .filter((x) => x.parsed);
  if (!groups.length) return null;
  const pickFrom = (list) => {
    let r = rng() * list.reduce((s, x) => s + x.weight, 0);
    for (const x of list) if ((r -= x.weight) <= 0) return x;
    return list[list.length - 1];
  };
  const first = pickFrom(groups);
  const up = first.parsed.up;
  const sameUp = groups.filter((x) => x.parsed.up === up);
  const hands = [first.parsed.hand];
  for (let i = 1; i < seats; i++) {
    const x = pickFrom(sameUp);
    hands.push(situationHand(x.g.situation, rng).hand);
  }
  return { hands, up };
}

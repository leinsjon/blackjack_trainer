// Running tally of mistakes across every session, grouped by situation, the
// action taken and the book action. Each group keeps how often it happened,
// the total dollars of EV lost and the EV lost per unit bet (so different bet
// sizes compare fairly).

const VERBS = { H: 'Hit', S: 'Stood on', D: 'Doubled', P: 'Split', R: 'Surrendered' };

export function mistakeKey(m) {
  return `${m.situation}|${m.chose}|${m.book}`;
}

export function addMistake(tally, m) {
  const key = mistakeKey(m);
  const g = (tally[key] ??= { situation: m.situation, chose: m.chose, book: m.book, count: 0, cost: 0, units: 0 });
  g.count += 1;
  g.cost += m.cost;
  g.units += m.stake > 0 ? m.cost / m.stake : 0;
  return tally;
}

export function buildTally(mistakeLists) {
  const tally = {};
  for (const list of mistakeLists) for (const m of list || []) addMistake(tally, m);
  return tally;
}

// Rows sorted by 'impact' (EV lost per hand, as a fraction of the bet),
// 'count' or 'cost' (total dollars), most costly first.
export function rankMistakes(tally, by = 'impact') {
  const rows = Object.values(tally).map((g) => ({
    ...g,
    perHand: g.units / g.count,
    label: `${VERBS[g.chose]} ${g.situation.charAt(0).toLowerCase()}${g.situation.slice(1)}`,
  }));
  const key = { impact: 'perHand', count: 'count', cost: 'cost' }[by] ?? 'perHand';
  return rows.sort((a, b) => b[key] - a[key] || b.cost - a.cost);
}

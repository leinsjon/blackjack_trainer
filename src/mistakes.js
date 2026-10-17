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

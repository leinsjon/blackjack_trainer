// Expected value of each player action, in units of the hand's bet.
//
// Uses the shoe composition after removing the cards on the table, then treats
// draws as coming from that fixed composition (no further depletion). The
// dealer is assumed to have peeked and not have blackjack. Splits are valued as
// two hands each starting from one card, without further resplits. This is an
// estimate that is usually within a fraction of a percent of exact values,
// which is plenty to price mistakes.

import { cardValue } from './strategy.js';

// Probability of drawing each value 1..10 (ace = 1), indexed by value.
export function composition(decks, removed = []) {
  const counts = Array(11).fill(0);
  for (let v = 1; v <= 9; v++) counts[v] = 4 * decks;
  counts[10] = 16 * decks;
  for (const c of removed) {
    const v = cardValue(c) === 11 ? 1 : cardValue(c);
    if (counts[v] > 0) counts[v]--;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  return counts.map((n) => n / total);
}

const best = (hard, ace) => (ace && hard + 10 <= 21 ? hard + 10 : hard);
const isSoft = (hard, ace) => ace && hard + 10 <= 21;

// Final dealer totals: index 0..4 = 17..21, index 5 = bust.
export function dealerOutcomes(up, p, h17) {
  const memo = new Map();
  const rec = (hard, ace, first) => {
    const key = `${hard},${ace},${first}`;
    if (memo.has(key)) return memo.get(key);
    const t = best(hard, ace);
    let out;
    if (t > 21) {
      out = [0, 0, 0, 0, 0, 1];
    } else if (t > 17 || (t === 17 && !(h17 && isSoft(hard, ace)))) {
      out = [0, 0, 0, 0, 0, 0];
      out[t - 17] = 1;
    } else {
      out = [0, 0, 0, 0, 0, 0];
      // After the peek, the hole card cannot complete a blackjack.
      let norm = 1;
      let exclude = 0;
      if (first && up === 1) exclude = 10;
      if (first && up === 10) exclude = 1;
      if (exclude) norm = 1 - p[exclude];
      for (let v = 1; v <= 10; v++) {
        if (v === exclude || p[v] === 0) continue;
        const sub = rec(hard + v, ace || v === 1, false);
        const w = p[v] / norm;
        for (let i = 0; i < 6; i++) out[i] += w * sub[i];
      }
    }
    memo.set(key, out);
    return out;
  };
  return rec(up, up === 1, true);
}

function standEV(total, dealer) {
  if (total > 21) return -1;
  let ev = dealer[5];
  for (let i = 0; i < 5; i++) {
    const d = 17 + i;
    if (total > d) ev += dealer[i];
    else if (total < d) ev -= dealer[i];
  }
  return ev;
}

function canDoubleTotal(hard, ace, doubleOn) {
  if (doubleOn === 'any') return true;
  if (isSoft(hard, ace)) return false;
  const t = best(hard, ace);
  return doubleOn === '9-11' ? t >= 9 && t <= 11 : t >= 10 && t <= 11;
}

// EVs for a hand. `available` says which of H, S, D, P, R are allowed.
// Returns an object with an EV for each available action.
export function actionEVs(cards, upCard, rules, available, removed = cards.concat([upCard])) {
  const p = composition(rules.decks, removed);
  const up = cardValue(upCard) === 11 ? 1 : cardValue(upCard);
  const dealer = dealerOutcomes(up, p, rules.h17);

  // Best EV when the only choices left are hit or stand.
  const hsMemo = new Map();
  const hitStand = (hard, ace) => {
    if (hard > 21) return -1;
    const key = `${hard},${ace}`;
    if (hsMemo.has(key)) return hsMemo.get(key);
    const stand = standEV(best(hard, ace), dealer);
    const v = best(hard, ace) >= 21 ? stand : Math.max(stand, hitEV(hard, ace));
    hsMemo.set(key, v);
    return v;
  };
  const hitEV = (hard, ace) => {
    let ev = 0;
    for (let v = 1; v <= 10; v++) ev += p[v] * hitStand(hard + v, ace || v === 1);
    return ev;
  };
  const doubleEV = (hard, ace) => {
    let ev = 0;
    for (let v = 1; v <= 10; v++) {
      const h = hard + v;
      ev += p[v] * (h > 21 ? -1 : standEV(best(h, ace || v === 1), dealer));
    }
    return 2 * ev;
  };

  let hard = 0;
  let ace = false;
  for (const c of cards) {
    const v = cardValue(c) === 11 ? 1 : cardValue(c);
    hard += v;
    if (v === 1) ace = true;
  }

  const evs = {};
  if (available.S) evs.S = standEV(best(hard, ace), dealer);
  if (available.H) evs.H = hitEV(hard, ace);
  if (available.D) evs.D = doubleEV(hard, ace);
  if (available.R) evs.R = -0.5;
  if (available.P) {
    const v = cardValue(cards[0]) === 11 ? 1 : cardValue(cards[0]);
    let one = 0;
    for (let c = 1; c <= 10; c++) {
      const h = v + c;
      const a = v === 1 || c === 1;
      let ev;
      if (v === 1) {
        ev = standEV(best(h, a), dealer); // split aces get one card
      } else {
        ev = hitStand(h, a);
        if (rules.das && canDoubleTotal(h, a, rules.doubleOn)) ev = Math.max(ev, doubleEV(h, a));
      }
      one += p[c] * ev;
    }
    evs.P = 2 * one;
  }
  return evs;
}

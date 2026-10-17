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

// Moments of a hand's result: { ev, m2 } where m2 = E[result²], per unit bet.
const mix = (parts) => {
  let ev = 0;
  let m2 = 0;
  for (const [w, m] of parts) {
    ev += w * m.ev;
    m2 += w * m.m2;
  }
  return { ev, m2 };
};
const scale = (m, k) => ({ ev: m.ev * k, m2: m.m2 * k * k });
const BUST = { ev: -1, m2: 1 };

function stand(total, dealer) {
  if (total > 21) return BUST;
  let ev = dealer[5];
  let push = 0;
  for (let i = 0; i < 5; i++) {
    const d = 17 + i;
    if (total > d) ev += dealer[i];
    else if (total < d) ev -= dealer[i];
    else push += dealer[i];
  }
  return { ev, m2: 1 - push };
}

function canDoubleTotal(hard, ace, doubleOn) {
  if (doubleOn === 'any') return true;
  if (isSoft(hard, ace)) return false;
  const t = best(hard, ace);
  return doubleOn === '9-11' ? t >= 9 && t <= 11 : t >= 10 && t <= 11;
}

// Mean and second moment of each available action (H, S, D, P, R) for a hand,
// each action followed by best-EV play. Returns { action: { ev, m2 } }.
export function actionMoments(cards, upCard, rules, available, removed = cards.concat([upCard])) {
  const p = composition(rules.decks, removed);
  const up = cardValue(upCard) === 11 ? 1 : cardValue(upCard);
  const dealer = dealerOutcomes(up, p, rules.h17);
  const draws = (fn) => {
    const parts = [];
    for (let v = 1; v <= 10; v++) if (p[v] > 0) parts.push([p[v], fn(v)]);
    return mix(parts);
  };

  // Best play when the only choices left are hit or stand.
  const hsMemo = new Map();
  const hitStand = (hard, ace) => {
    if (hard > 21) return BUST;
    const key = `${hard},${ace}`;
    if (hsMemo.has(key)) return hsMemo.get(key);
    const s = stand(best(hard, ace), dealer);
    let out = s;
    if (best(hard, ace) < 21) {
      const h = hit(hard, ace);
      if (h.ev > s.ev) out = h;
    }
    hsMemo.set(key, out);
    return out;
  };
  const hit = (hard, ace) => draws((v) => hitStand(hard + v, ace || v === 1));
  const double = (hard, ace) =>
    scale(draws((v) => stand(best(hard + v, ace || v === 1), dealer)), 2);

  let hard = 0;
  let ace = false;
  for (const c of cards) {
    const v = cardValue(c) === 11 ? 1 : cardValue(c);
    hard += v;
    if (v === 1) ace = true;
  }

  const out = {};
  if (available.S) out.S = stand(best(hard, ace), dealer);
  if (available.H) out.H = hit(hard, ace);
  if (available.D) out.D = double(hard, ace);
  if (available.R) out.R = { ev: -0.5, m2: 0.25 };
  if (available.P) {
    const v = cardValue(cards[0]) === 11 ? 1 : cardValue(cards[0]);
    const one = draws((c) => {
      const h = v + c;
      const a = v === 1 || c === 1;
      if (v === 1) return stand(best(h, a), dealer); // split aces get one card
      let m = hitStand(h, a);
      if (rules.das && canDoubleTotal(h, a, rules.doubleOn)) {
        const d = double(h, a);
        if (d.ev > m.ev) m = d;
      }
      return m;
    });
    // Two hands treated as independent: E[(X1+X2)²] = 2·E[X²] + 2·E[X]².
    out.P = { ev: 2 * one.ev, m2: 2 * one.m2 + 2 * one.ev * one.ev };
  }
  return out;
}

// EV of each available action, per unit bet.
export function actionEVs(...args) {
  const moments = actionMoments(...args);
  return Object.fromEntries(Object.entries(moments).map(([a, m]) => [a, m.ev]));
}

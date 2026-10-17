import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, correctAction, buildChart } from '../src/strategy.js';
import { actionEVs } from '../src/ev.js';
import { Game, hiLo } from '../src/game.js';

const c = (rank) => ({ rank, suit: '♠' });
const ALL = { canDouble: true, canSplit: true, canSurrender: true };
const rules = (over = {}) => ({ ...DEFAULT_RULES, ...over });
const play = (a, b, up, r = rules(), av = ALL) =>
  correctAction([c(a), c(b)], up === 'A' ? 11 : Number(up), r, av);

test('6-deck S17 DAS LS chart matches the standard chart', () => {
  const chart = buildChart(rules());
  const row = (sec, label) => chart[sec].find((r) => r.label === label).cells.join(' ');
  assert.equal(row('hard', '16'), 'S S S S S H H Rh Rh Rh');
  assert.equal(row('hard', '15'), 'S S S S S H H H Rh H');
  assert.equal(row('hard', '12'), 'H H S S S H H H H H');
  assert.equal(row('hard', '11'), 'D D D D D D D D D H');
  assert.equal(row('hard', '9'), 'H D D D D H H H H H');
  assert.equal(row('soft', 'A,7'), 'S Ds Ds Ds Ds S S H H H');
  assert.equal(row('soft', 'A,2'), 'H H H D D H H H H H');
  assert.equal(row('pairs', '9,9'), 'P P P P P S P P S S');
  assert.equal(row('pairs', '4,4'), 'H H H P P H H H H H');
});

test('H17 changes', () => {
  const r = rules({ h17: true });
  assert.equal(play('6', '5', 'A', r), 'D');
  assert.equal(play('6', '5', 'A'), 'H');
  assert.equal(play('A', '7', '2', r), 'D');
  assert.equal(play('A', '8', '6', r), 'D');
  assert.equal(play('A', '8', '6'), 'S');
  assert.equal(play('10', '7', 'A', r), 'R');
  assert.equal(play('8', '8', 'A', r), 'R');
});

test('fallbacks when an action is not available', () => {
  const noDouble = { ...ALL, canDouble: false };
  assert.equal(play('6', '5', '6', rules(), noDouble), 'H');
  assert.equal(play('A', '7', '4', rules(), noDouble), 'S');
  const noSurrender = { ...ALL, canSurrender: false };
  assert.equal(play('10', '6', '10', rules(), noSurrender), 'H');
  const noSplit = { ...ALL, canSplit: false };
  assert.equal(play('8', '8', '10', rules(), noSplit), 'R');
  assert.equal(play('8', '8', '6', rules(), noSplit), 'S');
  assert.equal(play('A', 'A', '6', rules(), noSplit), 'H');
});

test('no DAS tightens small pair splits', () => {
  const r = rules({ das: false });
  assert.equal(play('2', '2', '2', r), 'H');
  assert.equal(play('4', '4', '5', r), 'H');
  assert.equal(play('6', '6', '2', r), 'H');
});

test('single deck doubles more', () => {
  const r = rules({ decks: 1 });
  assert.equal(play('5', '3', '6', r), 'D');
  assert.equal(play('A', '6', '2', r), 'D');
  assert.equal(play('6', '5', 'A', r), 'D');
});

test('EV estimates are close to known values', () => {
  const av = { H: true, S: true, D: true, P: true, R: true };
  const ev = actionEVs([c('10'), c('K')], c('10'), rules(), av);
  assert.ok(Math.abs(ev.S - 0.555) < 0.02, `20 vs 10 stand ${ev.S}`);
  const e11 = actionEVs([c('6'), c('5')], c('6'), rules(), { ...av, P: false });
  assert.ok(e11.D > e11.H && Math.abs(e11.D - 0.667) < 0.03);
  const e88 = actionEVs([c('8'), c('8')], c('10'), rules(), av);
  assert.ok(e88.P > e88.S && e88.P > e88.H);
});

test('split aces do not allow hitting and resplit follows the rule', () => {
  // Deterministic shoe: draws pop from the end.
  for (const rsa of [false, true]) {
    const g = new Game(rules({ resplitAces: rsa }));
    g.deal();
    g.shoe = [c('5'), c('9'), c('A')]; // next draws: A, 9, 5
    g.dealer = [c('7'), c('10')];
    g.hands[0].cards = [c('A'), c('A')];
    g.hands[0].done = false;
    g.active = 0;
    g.phase = 'player';
    g.act('P');
    const av = g.available();
    assert.equal(av.H, false);
    assert.equal(av.P, rsa);
    if (!rsa) assert.equal(g.phase, 'over'); // both aces auto-stand
  }
});

test('a full round settles and tracks EV lost', () => {
  const g = new Game(rules());
  g.deal();
  g.shoe = [c('2'), c('10')];
  g.dealer = [c('10'), c('7')];
  g.hands[0].cards = [c('10'), c('2')];
  g.hands[0].done = false;
  g.active = 0;
  g.seatStats = new Map();
  g.phase = 'player';
  const fb = g.act('S'); // book play is hit
  assert.equal(fb.correct, false);
  assert.ok(fb.evLost > 0);
  assert.equal(g.phase, 'over');
  assert.equal(g.results[0].outcome, 'lose');
  assert.equal(g.results[0].net, -100);
  assert.ok(Math.abs(g.expectedNet - (fb.evs.H * 100 - fb.evLost)) < 1e-9);
});

test('multiple seats are dealt and played left to right', () => {
  const g = new Game(rules());
  for (let i = 0; i < 50; i++) {
    g.deal({ wagers: [25, 0, 100] });
    assert.deepEqual([...new Set(g.hands.map((h) => h.seat))], [0, 2]);
    assert.ok(g.hands.every((h) => h.cards.length === 2));
    while (g.phase === 'player') g.act(g.expected());
    assert.equal(g.results.length, g.hands.length);
  }
});

test('running count tracks every revealed card', () => {
  const g = new Game(rules({ decks: 1 }));
  g.deal({ wagers: [100, 100, 100] });
  while (g.phase === 'player') g.act('S');
  const seen = g.hands.flatMap((h) => h.cards).concat(g.dealer);
  assert.equal(g.runningCount, seen.reduce((s, card) => s + hiLo(card), 0));
  // A full shoe counts back to zero.
  const g2 = new Game(rules({ decks: 2 }));
  while (g2.shoe.length) g2.draw();
  assert.equal(g2.runningCount, 0);
});

test('outcome moments and house edge', async () => {
  const { actionMoments } = await import('../src/ev.js');
  const { houseEdge, roundVariance } = await import('../src/edge.js');
  const m = actionMoments([c('10'), c('K')], c('10'), rules(), { S: true });
  assert.ok(m.S.m2 > 0.55 && m.S.m2 < 0.75, `stand m2 ${m.S.m2}`);
  const d = actionMoments([c('6'), c('5')], c('6'), rules(), { D: true });
  assert.ok(d.D.m2 > 3 && d.D.m2 <= 4);
  const he = houseEdge(rules());
  assert.ok(he > 0.002 && he < 0.006, `6D S17 DAS LS edge ${he}`);
  assert.ok(houseEdge(rules({ blackjackPays: '6:5' })) > he + 0.01);
  assert.ok(Math.abs(roundVariance([100]) - 13225) < 1);
  const g = new Game(rules());
  let rounds = 0;
  let positive = 0;
  while (rounds < 30) {
    g.deal({ wagers: [100, 50] });
    if (g.phase === 'over') continue;
    while (g.phase === 'player') g.act(g.expected());
    // Zero only when every decision was a surrender (a certain result).
    assert.ok(g.variance >= 0);
    if (g.variance > 0) positive++;
    rounds++;
  }
  assert.ok(positive > 20);
});

test('mistake log ranks by per-hand EV and filters recent hands', async () => {
  const { rankMistakes, recentMistakes } = await import('../src/mistakes.js');
  const log = [
    { id: 1, hand: 10, situation: 'Hard 12 vs dealer 3', chose: 'S', book: 'H', cost: 2, stake: 100 },
    { id: 2, hand: 150, situation: 'Hard 12 vs dealer 3', chose: 'S', book: 'H', cost: 4, stake: 200 },
    { id: 3, hand: 20, situation: 'Pair of 10s vs dealer 6', chose: 'P', book: 'S', cost: 20, stake: 100 },
    { id: 4, hand: 200, situation: 'Soft 18 vs dealer 9', chose: 'S', book: 'H', cost: 1, stake: 25 },
  ];
  const rows = rankMistakes(log);
  assert.equal(rows[0].label, 'Split pair of 10s vs dealer 6');
  assert.equal(rows[1].label, 'Stood on soft 18 vs dealer 9');
  const h12 = rows.find((r) => r.situation === 'Hard 12 vs dealer 3');
  assert.equal(h12.count, 2);
  assert.ok(Math.abs(h12.perHand - 0.02) < 1e-9);
  assert.deepEqual(h12.entries.map((e) => e.id), [2, 1]);
  assert.equal(rankMistakes(log, 'count')[0].situation, 'Hard 12 vs dealer 3');
  // Last 100 of 200 hands: hands 101-200.
  assert.deepEqual(recentMistakes(log, 200, 100).map((m) => m.id), [2, 4]);
  assert.equal(recentMistakes(log, 200, null).length, 4);
});

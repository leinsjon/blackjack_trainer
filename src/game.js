import {
  cardValue,
  handTotal,
  isPair,
  isBlackjack,
  correctAction,
  describeHand,
  doubleAllowedForTotal,
} from './strategy.js';
import { actionEVs } from './ev.js';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

export const SEATS = 3;

export function buildShoe(decks, rng = Math.random) {
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit });
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// Hi-Lo tag: 2-6 = +1, 7-9 = 0, tens and aces = -1.
export function hiLo(card) {
  const v = cardValue(card);
  if (v <= 6) return 1;
  if (v >= 10) return -1;
  return 0;
}

// Card values for a focused drill hand: 'hard', 'soft' or 'pairs'.
export function drillValues(focus, rng = Math.random) {
  const pick = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  let values;
  if (focus === 'soft') {
    values = [11, pick(2, 9)];
  } else if (focus === 'pairs') {
    const v = pick(2, 11);
    values = [v, v];
  } else {
    // Hard totals 5-17 from two different non-ace values.
    do {
      values = [pick(2, 10), pick(2, 10)];
    } while (values[0] === values[1] || values[0] + values[1] > 17);
  }
  if (rng() < 0.5) values.reverse();
  return values;
}

export class Game {
  constructor(rules, { rng = Math.random } = {}) {
    this.rng = rng;
    this.setRules(rules);
  }

  setRules(rules) {
    this.rules = { ...rules };
    this.shuffle();
    this.phase = 'idle';
    this.hands = [];
    this.dealer = [];
    this.active = 0;
    this.results = null;
    this.holeRevealed = false;
  }

  shuffle() {
    this.shoe = buildShoe(this.rules.decks, this.rng);
    this.shoeSize = this.shoe.length;
    this.runningCount = 0;
    this.justShuffled = true;
  }

  get decksRemaining() {
    return this.shoe.length / 52;
  }

  get trueCount() {
    return this.runningCount / Math.max(this.decksRemaining, 0.25);
  }

  draw({ counted = true } = {}) {
    if (this.shoe.length === 0) this.shuffle();
    const card = this.shoe.pop();
    if (counted) this.runningCount += hiLo(card);
    return card;
  }

  // Pulls a card of the given value from the shoe for drills, so the count and
  // shoe composition stay consistent.
  take(value) {
    for (let i = this.shoe.length - 1; i >= 0; i--) {
      if (cardValue(this.shoe[i]) === value) {
        const [card] = this.shoe.splice(i, 1);
        this.runningCount += hiLo(card);
        return card;
      }
    }
    return this.draw();
  }

  // wagers: dollar bet per seat (0 or missing = empty seat).
  // focus: 'all' | 'hard' | 'soft' | 'pairs'. playOut: keep playing after the
  // first decision on each hand instead of ending it there.
  deal({ wagers = [100], focus = 'all', playOut = true } = {}) {
    this.justShuffled = false;
    if (this.shoe.length < this.shoeSize * 0.25) this.shuffle();
    this.playOut = playOut;
    this.hands = [];
    wagers.forEach((w, seat) => {
      if (w > 0) this.hands.push(newHand(seat, w));
    });
    if (this.hands.length === 0) throw new Error('No bets placed');

    // Deal like a casino: one card to each seat, dealer upcard, second card to
    // each seat, dealer hole card (not counted until revealed).
    const drill = focus !== 'all' ? this.hands.map(() => drillValues(focus, this.rng)) : null;
    for (let round = 0; round < 2; round++) {
      this.hands.forEach((h, i) => {
        h.cards.push(drill ? this.take(drill[i][round]) : this.draw());
      });
      if (round === 0) this.dealer = [this.draw()];
      else this.dealer.push(this.draw({ counted: false }));
    }
    this.holeRevealed = false;

    this.active = 0;
    this.results = null;
    this.expectedNet = null;
    this.seatStats = new Map();
    this.phase = 'player';
    for (const h of this.hands) {
      if (isBlackjack(h.cards)) h.done = true;
    }
    if (isBlackjack(this.dealer)) {
      this.hands.forEach((h) => (h.done = true));
    }
    this.advance();
    return this;
  }

  get upValue() {
    return cardValue(this.dealer[0]);
  }

  get hand() {
    return this.hands[this.active];
  }

  available(hand = this.hand) {
    if (this.phase !== 'player' || !hand || hand.done) {
      return { H: false, S: false, D: false, P: false, R: false };
    }
    const r = this.rules;
    const two = hand.cards.length === 2;
    const aces = two && hand.cards[0].rank === 'A' && hand.cards[1].rank === 'A';
    const seatHands = this.hands.filter((h) => h.seat === hand.seat).length;
    const canSplit =
      isPair(hand.cards) &&
      seatHands < r.maxHands &&
      (!aces || !hand.splitAces || r.resplitAces);
    return {
      H: !hand.splitAces,
      S: true,
      D:
        two &&
        !hand.splitAces &&
        (!hand.fromSplit || r.das) &&
        doubleAllowedForTotal(hand.cards, r),
      P: canSplit,
      R: r.surrender && two && !hand.fromSplit,
    };
  }

  // The basic strategy play for the active hand.
  expected() {
    const hand = this.hand;
    const av = this.available(hand);
    if (hand.splitAces) return av.P ? 'P' : 'S';
    return correctAction(hand.cards, this.upValue, this.rules, {
      canDouble: av.D,
      canSplit: av.P,
      canSurrender: av.R,
    });
  }

  // Plays an action for the active hand. Returns feedback about the decision.
  act(action) {
    const av = this.available();
    if (!av[action]) throw new Error(`Action ${action} is not available`);
    const hand = this.hand;
    const expected = this.expected();
    const visible = this.hands.flatMap((h) => h.cards).concat([this.dealer[0]]);
    const evs = actionEVs(hand.cards, this.dealer[0], this.rules, av, visible);
    // Money at risk on this decision: the wager times any doubling so far.
    const stake = hand.bet * hand.wager;
    const evLost = Math.max(0, evs[expected] - evs[action]) * stake;
    const seat = this.seatState(hand.seat);
    if (seat.bookEV === null) seat.bookEV = evs[expected] * hand.wager;
    seat.evLost += evLost;

    const feedback = {
      action,
      expected,
      correct: action === expected,
      evs, // per unit of stake
      stake,
      evLost, // dollars
      seat: hand.seat,
      situation: `${describeHand(hand.cards, av.P)} vs dealer ${upLabel(this.dealer[0])}`,
    };

    switch (action) {
      case 'H':
        hand.cards.push(this.draw());
        if (handTotal(hand.cards).total >= 21) hand.done = true;
        break;
      case 'S':
        hand.done = true;
        break;
      case 'D':
        hand.cards.push(this.draw());
        hand.bet *= 2;
        hand.done = true;
        break;
      case 'R':
        hand.surrendered = true;
        hand.done = true;
        break;
      case 'P': {
        const splitAces = hand.cards[0].rank === 'A';
        const second = newHand(hand.seat, hand.wager);
        second.cards.push(hand.cards.pop());
        for (const h of [hand, second]) {
          h.fromSplit = true;
          h.splitAces = splitAces;
          h.cards.push(this.draw());
          if (splitAces) {
            // Split aces get one card; they stay open only to resplit.
            h.done = !(h.cards[1].rank === 'A' && this.rules.resplitAces);
          } else if (handTotal(h.cards).total === 21) {
            h.done = true;
          }
          if (!this.playOut) h.done = true;
        }
        this.hands.splice(this.active + 1, 0, second);
        break;
      }
    }
    if (!this.playOut) hand.done = true;

    this.advance();
    return feedback;
  }

  seatState(seat) {
    if (!this.seatStats.has(seat)) this.seatStats.set(seat, { bookEV: null, evLost: 0 });
    return this.seatStats.get(seat);
  }

  advance() {
    while (this.active < this.hands.length) {
      const h = this.hands[this.active];
      // Resplit aces may become impossible once the hand limit is reached.
      if (!h.done && h.splitAces && !this.available(h).P) h.done = true;
      if (!h.done) return;
      this.active++;
    }
    this.finish();
  }

  // Expected result of the round in dollars: per seat, the book EV at its
  // first decision minus EV lost to mistakes, or the actual result when the
  // seat was decided by a blackjack before any decision.
  computeExpected() {
    let total = 0;
    const seats = new Set(this.hands.map((h) => h.seat));
    for (const seat of seats) {
      const s = this.seatState(seat);
      if (s.bookEV === null) {
        this.hands.forEach((h, i) => {
          if (h.seat === seat) total += this.results[i].net;
        });
      } else {
        total += s.bookEV - s.evLost;
      }
    }
    return total;
  }

  finish() {
    this.phase = 'over';
    this.holeRevealed = true;
    this.runningCount += hiLo(this.dealer[1]);
    const r = this.rules;

    if (!this.playOut) {
      this.results = null;
      return;
    }

    const dealerBJ = isBlackjack(this.dealer);
    const natural = (h) => !h.fromSplit && isBlackjack(h.cards);
    const live = this.hands.some(
      (h) => !h.surrendered && !natural(h) && handTotal(h.cards).total <= 21
    );
    if (live && !dealerBJ) {
      for (;;) {
        const { total, soft } = handTotal(this.dealer);
        if (total < 17 || (total === 17 && soft && r.h17)) this.dealer.push(this.draw());
        else break;
      }
    }

    const dealerTotal = handTotal(this.dealer).total;
    const bjPays = r.blackjackPays === '6:5' ? 1.2 : 1.5;
    this.results = this.hands.map((h) => {
      const total = handTotal(h.cards).total;
      const stake = h.bet * h.wager;
      let outcome;
      let units;
      if (h.surrendered) [outcome, units] = ['surrender', -0.5];
      else if (natural(h) && dealerBJ) [outcome, units] = ['push', 0];
      else if (natural(h)) [outcome, units] = ['blackjack', bjPays];
      else if (dealerBJ) [outcome, units] = ['lose', -1];
      else if (total > 21) [outcome, units] = ['bust', -1];
      else if (dealerTotal > 21 || total > dealerTotal) [outcome, units] = ['win', 1];
      else if (total === dealerTotal) [outcome, units] = ['push', 0];
      else [outcome, units] = ['lose', -1];
      return { outcome, net: units * stake };
    });
    this.expectedNet = this.computeExpected();
  }
}

function newHand(seat, wager) {
  return {
    seat,
    wager,
    cards: [],
    bet: 1, // multiplier: 2 after doubling
    done: false,
    fromSplit: false,
    splitAces: false,
    surrendered: false,
  };
}

function upLabel(card) {
  const v = cardValue(card);
  return v === 11 ? 'A' : String(v);
}

import { DEFAULT_RULES, ACTION_NAMES, handTotal, buildChart } from './strategy.js';
import { Game, SEATS } from './game.js';
import { houseEdge, roundVariance } from './edge.js';
import { drawSdChart, cumulative } from './sdchart.js';

const CHIPS = [5, 25, 100, 500, 1000];
const DEFAULT_TRAINING = {
  focus: 'all',
  playOut: true,
  autoNext: false,
  wagers: [0, 100, 0],
  chip: 100,
  bankroll: 10000,
};
// Money amounts are in dollars.
const EMPTY_STATS = {
  decisions: 0,
  correct: 0,
  streak: 0,
  best: 0,
  rounds: 0,
  hands: 0,
  net: 0,
  expected: 0,
  evLost: 0,
  edgeCost: 0, // expected loss to the house edge with perfect play
  history: [], // per settled round: net, expected and variance
  mistakes: [],
};
const MAX_MISTAKES = 100;
const MAX_HISTORY = 10000;

const $ = (id) => document.getElementById(id);

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode); settings just won't persist.
  }
}

let rules = load('bj.rules', DEFAULT_RULES);
let training = load('bj.training', DEFAULT_TRAINING);
if (!Array.isArray(training.wagers) || training.wagers.length !== SEATS) {
  training.wagers = [...DEFAULT_TRAINING.wagers];
}
let stats = load('bj.stats', EMPTY_STATS);
stats.mistakes = Array.isArray(stats.mistakes) ? stats.mistakes : [];
stats.history = Array.isArray(stats.history) ? stats.history : [];

const game = new Game(rules);
let countVisible = false; // the count starts masked on every visit
let roundAllCorrect = true;
let roundMessages = [];
let autoTimer = null;

// ---------- formatting ----------

function money(x, signed = true) {
  const abs = Math.abs(x);
  const digits = abs >= 1000 || Math.abs(abs - Math.round(abs)) < 0.005 ? 0 : 2;
  const str =
    '$' + abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (!signed) return str;
  if (abs < 0.005) return '$0';
  return (x > 0 ? '+' : '−') + str;
}

function setMoney(el, x) {
  el.textContent = money(x);
  el.classList.toggle('pos', x > 0.005);
  el.classList.toggle('neg', x < -0.005);
}

function signed(n, digits = 0) {
  const v = n.toFixed(digits);
  return n > 0 ? `+${v}` : v === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : v;
}

function rulesSummary(r) {
  return [
    `${r.decks} deck${r.decks > 1 ? 's' : ''}`,
    r.h17 ? 'H17' : 'S17',
    r.das ? 'DAS' : 'no DAS',
    r.doubleOn === 'any' ? 'double any 2' : `double ${r.doubleOn}`,
    r.resplitAces ? 'RSA' : 'no RSA',
    r.surrender ? 'late surrender' : 'no surrender',
    `BJ ${r.blackjackPays}`,
  ].join(' · ');
}

// ---------- rendering ----------

// Cards already on screen. Each render rebuilds the table, so only cards not
// seen before get the deal animation; a revealed hole card does not re-deal.
let shownCards = new WeakSet();

function cardEl(card, hidden = false) {
  const el = document.createElement('div');
  const isNew = !shownCards.has(card);
  shownCards.add(card);
  if (isNew) el.classList.add('dealt');
  if (hidden) {
    el.classList.add('card', 'back');
    el.setAttribute('aria-label', 'Face-down card');
    return el;
  }
  const red = card.suit === '♥' || card.suit === '♦';
  el.classList.add('card');
  if (red) el.classList.add('red');
  el.setAttribute('aria-label', `${card.rank}${card.suit}`);
  el.innerHTML = `<div class="corner">${card.rank}<span>${card.suit}</span></div><div class="pip">${card.suit}</div>`;
  return el;
}

function chipEl(value) {
  const el = document.createElement('div');
  el.className = 'chip';
  el.dataset.v = value;
  el.textContent = value >= 1000 ? `${value / 1000}K` : value;
  return el;
}

function chipsFor(amount) {
  const out = [];
  let left = amount;
  for (const c of [...CHIPS].reverse()) {
    while (left >= c && out.length < 6) {
      out.push(c);
      left -= c;
    }
  }
  if (left > 0 && out.length < 6) out.push(5);
  return out;
}

// Last amount drawn on each betting circle, so only a changed stack animates.
const shownStacks = [];

function stackEl(amount, seat) {
  const changed = shownStacks[seat] !== amount;
  shownStacks[seat] = amount;
  const stack = document.createElement('div');
  stack.className = 'stack';
  chipsFor(amount)
    .reverse()
    .forEach((v, i) => {
      const chip = chipEl(v);
      chip.style.top = `${-i * 4}px`;
      if (changed) chip.classList.add('added');
      stack.append(chip);
    });
  return stack;
}

function totalLabel(cards) {
  const { total, soft } = handTotal(cards);
  if (cards.length === 2 && total === 21) return 'BJ';
  if (total > 21) return `${total}`;
  return soft && total < 21 ? `${total - 10}/${total}` : String(total);
}

const OUTCOME_TEXT = {
  win: 'Win',
  lose: 'Lose',
  push: 'Push',
  bust: 'Bust',
  blackjack: 'Blackjack',
  surrender: 'Surrender',
};

const betting = () => game.phase !== 'player';

function render() {
  const inRound = game.phase === 'player' || game.phase === 'over';
  const reveal = game.holeRevealed;

  // Dealer
  $('dealer-cards').replaceChildren(
    ...(inRound ? game.dealer.map((c, i) => cardEl(c, i === 1 && !reveal)) : [])
  );
  const dt = $('dealer-total');
  dt.hidden = !inRound;
  if (inRound) {
    dt.textContent = reveal ? totalLabel(game.dealer) : totalLabel([game.dealer[0]]);
    dt.classList.toggle('bust', reveal && handTotal(game.dealer).total > 21);
  }

  // Seats
  const seats = [];
  for (let s = 0; s < SEATS; s++) {
    const seat = document.createElement('div');
    seat.className = 'seat';
    const handsWrap = document.createElement('div');
    handsWrap.className = 'seat-hands';
    const seatHands = inRound ? game.hands.map((h, i) => [h, i]).filter(([h]) => h.seat === s) : [];
    if (seatHands.length > 1) handsWrap.classList.add('split');
    for (const [h, i] of seatHands) {
      const hand = document.createElement('div');
      hand.className = `hand${game.phase === 'player' && i === game.active ? ' active' : ''}`;
      const cards = document.createElement('div');
      cards.className = 'cards';
      cards.append(...h.cards.map((c) => cardEl(c)));
      const badge = document.createElement('div');
      badge.className = 'total-badge';
      badge.textContent = totalLabel(h.cards) + (h.bet > 1 ? ' ×2' : '');
      if (handTotal(h.cards).total > 21) badge.classList.add('bust');
      hand.append(cards, badge);
      const result = game.results?.[i];
      if (result) {
        const o = document.createElement('div');
        o.className = `outcome ${result.outcome}`;
        o.textContent = `${OUTCOME_TEXT[result.outcome]} ${result.net ? money(result.net) : ''}`.trim();
        hand.append(o);
      }
      handsWrap.append(hand);
    }

    const spot = document.createElement('div');
    const wager = training.wagers[s];
    const atRisk = seatHands.length
      ? seatHands.reduce((sum, [h]) => sum + h.bet * h.wager, 0)
      : wager;
    spot.className = `spot${betting() ? ' open' : ''}`;
    spot.setAttribute('role', 'button');
    spot.setAttribute('aria-label', `Betting circle ${s + 1}, ${wager ? money(wager, false) : 'no bet'}`);
    if (atRisk > 0) {
      spot.append(stackEl(atRisk, s));
      const amt = document.createElement('div');
      amt.className = 'spot-amount';
      amt.textContent = money(atRisk, false);
      spot.append(amt);
      if (betting() && wager > 0) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'remove';
        rm.setAttribute('aria-label', `Remove bet from circle ${s + 1}`);
        rm.textContent = '×';
        rm.addEventListener('click', (e) => {
          e.stopPropagation();
          setWager(s, 0);
        });
        spot.append(rm);
      }
    } else {
      shownStacks[s] = 0;
      spot.textContent = 'Bet';
    }
    spot.addEventListener('click', () => {
      if (betting()) setWager(s, training.wagers[s] + training.chip);
    });
    seat.append(handsWrap, spot);
    seats.push(seat);
  }
  $('seats').replaceChildren(...seats);

  // Controls
  const playing = game.phase === 'player';
  $('actions').hidden = !playing;
  $('betting').hidden = playing;
  const av = game.available();
  for (const btn of document.querySelectorAll('[data-action]')) {
    btn.disabled = !av[btn.dataset.action];
  }
  $('deal-btn').disabled = training.wagers.every((w) => !w);

  renderCount();
  renderStats();
}

function renderChipTray() {
  $('chip-tray').replaceChildren(
    ...CHIPS.map((v) => {
      const chip = chipEl(v);
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(v === training.chip));
      chip.setAttribute('aria-label', `${money(v, false)} chip`);
      chip.tabIndex = 0;
      chip.classList.toggle('selected', v === training.chip);
      chip.addEventListener('click', () => {
        training.chip = v;
        save('bj.training', training);
        renderChipTray();
      });
      return chip;
    })
  );
}

function renderCount() {
  const btn = $('count');
  btn.classList.toggle('masked', !countVisible);
  btn.setAttribute('aria-pressed', String(countVisible));
  btn.setAttribute('aria-label', countVisible ? 'Hide card count' : 'Show card count');
  $('count-value').textContent = countVisible
    ? `RC ${signed(game.runningCount)} · TC ${signed(game.trueCount, 1)}`
    : '• • •';
  const left = game.shoe.length / game.shoeSize;
  $('shoe-fill').style.height = `${Math.round(left * 100)}%`;
  $('shoe-label').textContent = `${game.decksRemaining.toFixed(1)} decks`;
}

function renderStats() {
  setMoney($('stat-net'), stats.net);
  setMoney($('stat-expected'), stats.expected);
  $('stat-lost').textContent = money(stats.evLost, false);
  $('stat-edge').textContent = money(stats.edgeCost, false);
  $('stat-lost').classList.toggle('neg', stats.evLost > 0.005);
  $('stat-accuracy').textContent = stats.decisions
    ? `${Math.round((stats.correct / stats.decisions) * 100)}%`
    : '–';
  $('stat-streak').textContent = stats.streak;
  $('balance').textContent = money(training.bankroll + stats.net, false);
  $('balance').classList.toggle('neg', training.bankroll + stats.net < 0);
}

function applyRules() {
  $('felt-main').textContent = `BLACKJACK PAYS ${rules.blackjackPays.replace(':', ' TO ')}`;
  $('felt-sub').textContent = `${rules.h17 ? 'Dealer hits soft 17' : 'Dealer stands on all 17s'} · ${rules.decks} deck${rules.decks > 1 ? 's' : ''}`;
}

function setFeedback(html, tone = '') {
  const el = $('feedback');
  el.className = `feedback ${tone}`;
  el.innerHTML = html;
}

// ---------- game flow ----------

function setWager(seat, amount) {
  training.wagers[seat] = Math.max(0, amount);
  save('bj.training', training);
  render();
}

function deal() {
  clearTimeout(autoTimer);
  if (training.wagers.every((w) => !w)) {
    setFeedback('Place a bet in at least one circle to deal.');
    return;
  }
  game.deal({ wagers: training.wagers, focus: training.focus, playOut: training.playOut });
  roundAllCorrect = true;
  roundMessages = [];
  const shuffled = game.justShuffled ? 'New shoe shuffled. ' : '';
  if (game.phase === 'over') {
    finishRound(shuffled);
  } else {
    setFeedback(`${shuffled}Your move on the highlighted hand.`);
  }
  render();
}

function finishRound(prefix = '') {
  if (game.results) {
    const net = game.results.reduce((s, r) => s + r.net, 0);
    stats.rounds++;
    stats.hands += new Set(game.hands.map((h) => h.seat)).size;
    stats.net += net;
    stats.expected += game.expectedNet;
    const wagers = [...new Map(game.hands.map((h) => [h.seat, h.wager])).values()];
    const edgeExpected = -houseEdge(rules) * wagers.reduce((a, b) => a + b, 0);
    stats.edgeCost -= edgeExpected;
    const r2 = (v) => Math.round(v * 100) / 100;
    if (stats.history.length < MAX_HISTORY) {
      stats.history.push({
        net: r2(net),
        exp: r2(game.expectedNet),
        var: r2(game.variance),
        hexp: r2(edgeExpected),
        hvar: r2(roundVariance(wagers)),
      });
    }
    save('bj.stats', stats);
    const last = roundMessages.at(-1);
    const decided = last ? `${last.html} ` : '';
    const noDecision = !last ? describeNaturals() + ' ' : '';
    setFeedback(
      `${prefix}${decided}${noDecision}Round ${money(net)} (expected ${money(game.expectedNet)}).`,
      last ? last.tone : ''
    );
  } else if (roundMessages.length) {
    const last = roundMessages.at(-1);
    setFeedback(prefix + last.html, last.tone);
  }
  if (training.autoNext && roundAllCorrect && roundMessages.length) {
    autoTimer = setTimeout(deal, 1600);
  }
}

function describeNaturals() {
  if (game.dealer.length === 2 && handTotal(game.dealer).total === 21) return 'Dealer has blackjack.';
  return 'Blackjack!';
}

function act(action) {
  if (!game.available()[action]) return;
  const fb = game.act(action);

  stats.decisions++;
  if (fb.correct) {
    stats.correct++;
    stats.streak++;
    stats.best = Math.max(stats.best, stats.streak);
  } else {
    stats.streak = 0;
    roundAllCorrect = false;
  }
  stats.evLost += fb.evLost;

  const name = ACTION_NAMES[fb.expected];
  const ev = (a) => money(fb.evs[a] * fb.stake);
  let html;
  if (fb.correct) {
    html = `✓ <strong>${name}</strong> is right on ${fb.situation}. EV ${ev(fb.expected)}.`;
  } else {
    html =
      `✗ You chose ${ACTION_NAMES[fb.action]}; book play is <strong>${name}</strong> on ${fb.situation}. ` +
      `Cost ${money(fb.evLost, false)} in EV (${ACTION_NAMES[fb.action]} ${ev(fb.action)} vs ${name} ${ev(fb.expected)}).`;
    stats.mistakes.unshift({
      situation: fb.situation,
      chose: fb.action,
      book: fb.expected,
      cost: fb.evLost,
      stake: fb.stake,
    });
    stats.mistakes.length = Math.min(stats.mistakes.length, MAX_MISTAKES);
  }
  const tone = fb.correct ? 'good' : 'bad';
  roundMessages.push({ html, tone });

  if (game.phase === 'over') finishRound();
  else setFeedback(html, tone);
  save('bj.stats', stats);
  render();
}

// ---------- dialogs ----------

function fillSettings() {
  const form = $('settings-form');
  const values = { ...rules, ...training };
  for (const el of form.elements) {
    if (!el.name || !(el.name in values)) continue;
    if (el.type === 'checkbox') el.checked = Boolean(values[el.name]);
    else el.value = String(values[el.name]);
  }
}

function readSettings() {
  const f = $('settings-form').elements;
  const nextRules = {
    decks: Number(f.decks.value),
    h17: f.h17.value === 'true',
    das: f.das.checked,
    doubleOn: f.doubleOn.value,
    surrender: f.surrender.checked,
    resplitAces: f.resplitAces.checked,
    maxHands: Number(f.maxHands.value),
    blackjackPays: f.blackjackPays.value,
  };
  const bankroll = Number(f.bankroll.value);
  const nextTraining = {
    ...training,
    focus: f.focus.value,
    playOut: f.playOut.checked,
    autoNext: f.autoNext.checked,
    bankroll: Number.isFinite(bankroll) && bankroll >= 0 ? bankroll : training.bankroll,
  };
  return { nextRules, nextTraining };
}

function renderChart() {
  const chart = buildChart(rules);
  const head = `<tr><th></th>${chart.ups.map((u) => `<th>${u === 11 ? 'A' : u}</th>`).join('')}</tr>`;
  const table = (title, rows) => `
    <table class="chart-table">
      <caption>${title}</caption>
      <thead>${head}</thead>
      <tbody>${rows
        .map((r) => `<tr><th>${r.label}</th>${r.cells.map((c) => `<td class="c-${c}">${c}</td>`).join('')}</tr>`)
        .join('')}</tbody>
    </table>`;
  $('chart-rules').textContent = rulesSummary(rules);
  $('chart-body').innerHTML =
    table('Hard totals', chart.hard) + table('Soft totals', chart.soft) + table('Pairs', chart.pairs);
}

function perHand(amount) {
  return stats.hands ? ` <small>(${money(amount / stats.hands, false)}/hand)</small>` : '';
}

function renderSession() {
  const rows = [
    ['Rounds played', String(stats.rounds)],
    ['Hands played', String(stats.hands)],
    ['Decisions', `${stats.decisions} (${stats.correct} by the book)`],
    ['Best streak', String(stats.best)],
    ['Net winnings', money(stats.net)],
    ['Expected (your play)', money(stats.expected)],
    ['House edge for these rules', `${(houseEdge(rules) * 100).toFixed(2)}%`],
    ['EV lost to house edge (perfect play)', `${money(stats.edgeCost, false)}${perHand(stats.edgeCost)}`],
    ['EV lost to mistakes', `${money(stats.evLost, false)}${perHand(stats.evLost)}`],
    ['Total EV lost', `${money(stats.edgeCost + stats.evLost, false)}${perHand(stats.edgeCost + stats.evLost)}`],
    ['Luck (net − expected)', money(stats.net - stats.expected)],
  ];
  drawSdChart($('sd-dealt'), cumulative(stats.history, 'exp', 'var'), { label: 'Net vs cards dealt' });
  drawSdChart($('sd-blind'), cumulative(stats.history, 'hexp', 'hvar'), { label: 'Net vs hands and stakes' });
  $('session-summary').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  if (stats.mistakes.length === 0) {
    $('mistakes').innerHTML = '<p class="note">No mistakes yet.</p>';
    return;
  }
  $('mistakes').innerHTML = `
    <table class="mistake-table">
      <thead><tr><th>Hand</th><th>You</th><th>Book</th><th>EV lost</th></tr></thead>
      <tbody>${stats.mistakes
        .map(
          (m) =>
            `<tr><td>${m.situation}</td><td>${ACTION_NAMES[m.chose]}</td><td>${ACTION_NAMES[m.book]}</td><td>${money(m.cost, false)}</td></tr>`
        )
        .join('')}</tbody>
    </table>`;
}

// ---------- events ----------

document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => act(btn.dataset.action));
});
$('deal-btn').addEventListener('click', deal);
$('clear-bets').addEventListener('click', () => {
  training.wagers = training.wagers.map(() => 0);
  save('bj.training', training);
  render();
});

$('count').addEventListener('click', () => {
  countVisible = !countVisible;
  renderCount();
});

$('settings-btn').addEventListener('click', () => {
  fillSettings();
  $('settings').showModal();
});
$('settings').addEventListener('close', () => {
  if ($('settings').returnValue !== 'save') return;
  const { nextRules, nextTraining } = readSettings();
  const rulesChanged = JSON.stringify(nextRules) !== JSON.stringify(rules);
  rules = nextRules;
  training = nextTraining;
  save('bj.rules', rules);
  save('bj.training', training);
  applyRules();
  if (rulesChanged) {
    game.setRules(rules);
    setFeedback('Rules updated and the shoe was reshuffled. Place your bets.');
  }
  render();
});

const openSession = () => {
  renderSession();
  $('session').showModal();
};
$('session-btn').addEventListener('click', openSession);
$('stat-lost').addEventListener('click', openSession);
$('stat-edge').addEventListener('click', openSession);
$('session-close').addEventListener('click', () => $('session').close());
$('reset-stats').addEventListener('click', () => {
  stats = { ...EMPTY_STATS, mistakes: [], history: [] };
  save('bj.stats', stats);
  renderStats();
  renderSession();
});

$('chart-btn').addEventListener('click', () => {
  renderChart();
  $('chart').showModal();
});
$('chart-close').addEventListener('click', () => $('chart').close());

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toUpperCase();
  if (betting() && (key === ' ' || key === 'ENTER')) {
    e.preventDefault();
    deal();
  } else if (key.length === 1 && 'HSDPR'.includes(key)) {
    act(key);
  }
});

applyRules();
renderChipTray();
setFeedback('Place your bets, then deal.');
render();

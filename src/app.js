import { DEFAULT_RULES, ACTION_NAMES, handTotal, buildChart } from './strategy.js';
import { Game, SEATS } from './game.js';
import { houseEdge, roundVariance } from './edge.js';
import { drawSdChart, cumulative } from './sdchart.js';
import { chipSVG } from './chips.js';
import { rankMistakes, recentMistakes, mistakeScenario } from './mistakes.js';
import { initCountTrainer } from './counting.js';

const CHIPS = [5, 25, 100, 500, 1000];
const DEFAULT_TRAINING = {
  focus: 'all',
  playOut: true,
  autoNext: false,
  quizEvery: 0, // in-game count quiz every N rounds (0 = off)
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
// Version 2 made late surrender off by default: turn it off once for saved rules.
if ((rules.version ?? 1) < 2) {
  rules.surrender = false;
}
delete rules.version;
delete rules.hitSplitAces; // option that was briefly offered, then removed
const RULES_VERSION = 2;
const saveRules = () => save('bj.rules', { ...rules, version: RULES_VERSION });
saveRules();
let training = load('bj.training', DEFAULT_TRAINING);
if (!Array.isArray(training.wagers) || training.wagers.length !== SEATS) {
  training.wagers = [...DEFAULT_TRAINING.wagers];
}
let stats = load('bj.stats', EMPTY_STATS);
stats.mistakes = Array.isArray(stats.mistakes) ? stats.mistakes : [];
stats.history = Array.isArray(stats.history) ? stats.history : [];
stats.startedAt ??= Date.now();
const MAX_ARCHIVE = 25;
let archive = loadArchive();

// Totals of every closed session, kept apart from the archive so they survive
// old sessions rolling off it. Seeded from the archive the first time.
const LIFETIME_FIELDS = ['rounds', 'hands', 'decisions', 'correct', 'net', 'expected', 'evLost', 'edgeCost'];
const MAX_LIFETIME_HISTORY = 20000;
let lifetime = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('bj.lifetime') || 'null');
    if (saved && typeof saved === 'object') return saved;
  } catch {
    // rebuild below
  }
  const base = { best: 0, history: [], startedAt: null };
  for (const f of LIFETIME_FIELDS) base[f] = 0;
  for (const a of [...archive].reverse()) addToLifetime(base, a);
  return base;
})();

function addToLifetime(total, s) {
  for (const f of LIFETIME_FIELDS) total[f] += s[f] || 0;
  total.best = Math.max(total.best, s.best || 0);
  total.history = total.history.concat(s.history || []).slice(-MAX_LIFETIME_HISTORY);
  if (s.startedAt && (!total.startedAt || s.startedAt < total.startedAt)) total.startedAt = s.startedAt;
  return total;
}

function saveLifetime() {
  try {
    localStorage.setItem('bj.lifetime', JSON.stringify(lifetime));
  } catch {
    lifetime.history = lifetime.history.slice(-5000);
    save('bj.lifetime', lifetime);
  }
}

// All-time hand counter and mistake log, kept across sessions. Mistakes from
// before the log existed are seeded from the session logs with hand 0, so
// they only show under "All hands".
const MAX_LOG = 5000;
let handCount = Number(localStorage.getItem('bj.handCount')) || 0;
let mistakeLog = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('bj.mistakeLog') || 'null');
    if (Array.isArray(saved)) return saved;
  } catch {
    // fall through and rebuild
  }
  let id = 0;
  return [stats.mistakes, ...archive.map((a) => a.mistakes || [])]
    .flat()
    .map((m) => {
      m.id ??= `legacy-${id++}`;
      return { ...m, hand: 0 };
    });
})();
let nextMistakeId = Date.now();

function saveMistakes() {
  save('bj.mistakeLog', mistakeLog);
  save('bj.stats', stats);
}

function loadArchive() {
  try {
    const list = JSON.parse(localStorage.getItem('bj.archive') || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

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
  el.innerHTML = chipSVG(value);
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

let roundsSinceQuiz = 0;

function deal() {
  clearTimeout(autoTimer);
  if (training.wagers.every((w) => !w)) {
    setFeedback('Place a bet in at least one circle to deal.');
    return;
  }
  // In-game count quiz: ask before dealing, once enough rounds have gone by
  // since the last check (and only mid-shoe, when there is a count to keep).
  if (training.quizEvery > 0 && roundsSinceQuiz >= training.quizEvery && !game.justShuffled && game.phase === 'over') {
    roundsSinceQuiz = 0;
    countTrainer.quiz(
      { rc: game.runningCount, tc: game.trueCount, decksLeft: game.decksRemaining },
      $('count-quiz'),
      deal
    );
    return;
  }
  roundsSinceQuiz++;
  let scenario = null;
  let note = '';
  if (training.focus === 'mistakes') {
    scenario = mistakeScenario(mistakeLog, training.wagers.filter((w) => w > 0).length);
    if (!scenario) note = 'No mistakes to drill yet, so this hand is dealt normally. ';
  }
  game.deal({ wagers: training.wagers, focus: training.focus, playOut: training.playOut, scenario });
  handCount += new Set(game.hands.map((h) => h.seat)).size;
  try {
    localStorage.setItem('bj.handCount', String(handCount));
  } catch {
    // storage unavailable
  }
  roundAllCorrect = true;
  roundMessages = [];
  const shuffled = game.justShuffled ? 'New shoe shuffled. ' : '';
  if (game.phase === 'over') {
    finishRound(shuffled);
  } else {
    setFeedback(`${note}${shuffled}Your move on the highlighted hand.`);
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
    const mistake = {
      id: `m${nextMistakeId++}`,
      hand: handCount,
      t: Date.now(),
      situation: fb.situation,
      chose: fb.action,
      book: fb.expected,
      cost: fb.evLost,
      stake: fb.stake,
    };
    stats.mistakes.unshift(mistake);
    stats.mistakes.length = Math.min(stats.mistakes.length, MAX_MISTAKES);
    mistakeLog.push(mistake);
    if (mistakeLog.length > MAX_LOG) mistakeLog.splice(0, mistakeLog.length - MAX_LOG);
    save('bj.mistakeLog', mistakeLog);
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
    quizEvery: Number(f.quizEvery.value),
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
  $('session-started').textContent = `Started ${dateFmt(stats.startedAt)}`;
  const rows = sessionRows(stats);
  rows.splice(6, 0, ['House edge for these rules', `${(houseEdge(rules) * 100).toFixed(2)}%`]);
  rows.splice(9, 0, [
    'Total EV lost',
    `${money(stats.edgeCost + stats.evLost, false)}${perHand(stats.edgeCost + stats.evLost)}`,
  ]);
  $('session-summary').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  drawSdChart($('sd-dealt'), cumulative(stats.history, 'exp', 'var'), { label: 'Net vs cards dealt' });
  drawSdChart($('sd-blind'), cumulative(stats.history, 'hexp', 'hvar'), { label: 'Net vs hands and stakes' });
  $('mistakes').innerHTML = mistakesTable(stats.mistakes);
  renderArchive();
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
  saveRules();
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
// Archives the current session (if anything was played) and starts fresh:
// stats, balance, mistakes, charts and the shoe all reset.
function newSession() {
  const played = stats.rounds > 0 || stats.decisions > 0;
  const msg = played
    ? 'Start a new session? This session will be saved to the archive and all stats reset.'
    : 'Start a new session? All stats will be reset.';
  if (!window.confirm(msg)) return;
  clearTimeout(autoTimer);
  if (played) {
    addToLifetime(lifetime, stats);
    saveLifetime();
    archive.unshift({
      ...stats,
      endedAt: Date.now(),
      rules: rulesSummary(rules),
      houseEdge: houseEdge(rules),
      bankroll: training.bankroll,
    });
    archive.length = Math.min(archive.length, MAX_ARCHIVE);
    try {
      localStorage.setItem('bj.archive', JSON.stringify(archive));
    } catch {
      // Too large or storage unavailable: drop chart history from old entries and retry.
      archive.forEach((a, i) => i > 0 && (a.history = []));
      try {
        localStorage.setItem('bj.archive', JSON.stringify(archive));
      } catch {
        // Keep the archive in memory for this visit only.
      }
    }
  }
  stats = { ...EMPTY_STATS, mistakes: [], history: [], startedAt: Date.now() };
  save('bj.stats', stats);
  game.setRules(rules); // fresh shoe, count back to zero
  setFeedback(played ? 'New session started. The last one is in the archive under Session.' : 'New session started.');
  render();
  if ($('session').open) renderSession();
}

$('reset-stats').addEventListener('click', newSession);
$('new-session-btn').addEventListener('click', newSession);

function sessionRows(s) {
  const hands = s.hands || 0;
  const per = (x) => (hands ? ` <small>(${money(x / hands, false)}/hand)</small>` : '');
  return [
    ['Rounds played', String(s.rounds)],
    ['Hands played', String(hands)],
    ['Decisions', `${s.decisions} (${s.correct} by the book)`],
    ['Best streak', String(s.best)],
    ['Net winnings', money(s.net)],
    ['Expected (your play)', money(s.expected)],
    ['EV lost to house edge (perfect play)', `${money(s.edgeCost || 0, false)}${per(s.edgeCost || 0)}`],
    ['EV lost to mistakes', `${money(s.evLost, false)}${per(s.evLost)}`],
    ['Luck (net − expected)', money(s.net - s.expected)],
  ];
}

// Mistakes grouped by situation, action and book play, costliest first.
function mistakesTable(list) {
  if (!list.length) return '<p class="note">No mistakes.</p>';
  const rows = rankMistakes(list, 'cost');
  return `
    <table class="mistake-table">
      <thead><tr><th>Hand</th><th>You</th><th>Book</th><th class="num">Times</th><th>EV lost</th></tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr><td>${r.situation}</td><td>${ACTION_NAMES[r.chose]}</td><td>${ACTION_NAMES[r.book]}</td><td class="num">${r.count}</td><td>${money(r.cost, false)}</td></tr>`
        )
        .join('')}</tbody>
    </table>`;
}

const dateFmt = (t) =>
  new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Every hand ever played: closed sessions plus the current one.
function allHandsEntry() {
  const all = addToLifetime(structuredClone(lifetime), stats);
  return { ...all, mistakes: mistakeLog };
}

function archiveItem(a, i, { allHands = false } = {}) {
  const acc = a.decisions ? `${Math.round((a.correct / a.decisions) * 100)}%` : '–';
  const netClass = a.net > 0.005 ? 'pos' : a.net < -0.005 ? 'neg' : '';
  const note = allHands
    ? `Every session${a.startedAt ? ` since ${dateFmt(a.startedAt)}` : ''}, including this one. Totals keep counting after old sessions leave the archive.`
    : `${a.rules}${a.houseEdge !== undefined ? ` · house edge ${(a.houseEdge * 100).toFixed(2)}%` : ''}. Ended ${dateFmt(a.endedAt)}.`;
  return `
      <details class="archive-item${allHands ? ' all-hands' : ''}" data-i="${i}">
        <summary>
          <span class="a-date">${allHands ? 'All hands' : dateFmt(a.startedAt ?? a.endedAt)}</span>
          <span>${a.hands} hands</span>
          <span class="${netClass}">${money(a.net)}</span>
          <span>${acc}</span>
        </summary>
        <p class="note">${note}</p>
        <dl class="summary">${sessionRows(a).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        <h3>Net vs the cards dealt</h3>
        <div class="sd-chart a-dealt"></div>
        <h3>Net vs hands and stakes only</h3>
        <div class="sd-chart a-blind"></div>
        <h3>Mistakes</h3>
        ${mistakesTable(a.mistakes || [])}
      </details>`;
}

function renderArchive() {
  const el = $('archive');
  const all = allHandsEntry();
  const entries = [all, ...archive];
  el.innerHTML =
    archiveItem(all, 0, { allHands: true }) +
    (archive.length
      ? archive.map((a, i) => archiveItem(a, i + 1)).join('')
      : '<p class="note">No past sessions yet. Start a new session to archive this one.</p>');
  el.querySelectorAll('details').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (!d.open || d.dataset.drawn) return;
      const h = entries[Number(d.dataset.i)].history || [];
      drawSdChart(d.querySelector('.a-dealt'), cumulative(h, 'exp', 'var'), { label: 'Net vs cards dealt' });
      drawSdChart(d.querySelector('.a-blind'), cumulative(h, 'hexp', 'hvar'), { label: 'Net vs hands and stakes' });
      d.dataset.drawn = '1';
    });
  });
}

let mistakeSort = 'impact';
let mistakeWindow = 100; // last N hands; null = all
const openGroups = new Set();

// Removes mistakes (misclicks) from the all-time log. Ones from the current
// session also come off its stats: they count as correct decisions and their
// EV cost is refunded. Archived session totals are left as they were.
function purgeMistakes(ids) {
  const remove = new Set(ids);
  mistakeLog = mistakeLog.filter((m) => !remove.has(m.id));
  const kept = [];
  for (const m of stats.mistakes) {
    if (remove.has(m.id)) {
      stats.correct += 1;
      stats.evLost = Math.max(0, stats.evLost - m.cost);
      stats.expected += m.cost;
    } else {
      kept.push(m);
    }
  }
  stats.mistakes = kept;
  saveMistakes();
  renderStats();
  renderMistakeSummary();
}

function renderMistakeSummary() {
  const entries = recentMistakes(mistakeLog, handCount, mistakeWindow);
  const rows = rankMistakes(entries, mistakeSort);
  const total = entries.length;
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const span = mistakeWindow == null ? 'across all hands' : `in your last ${Math.min(mistakeWindow, handCount)} hands`;
  $('ms-total').textContent = total
    ? `${total} mistake${total === 1 ? '' : 's'} ${span} in ${rows.length} situation${rows.length === 1 ? '' : 's'}, ${money(cost, false)} of EV lost.`
    : '';
  for (const b of document.querySelectorAll('[data-sort]')) {
    b.setAttribute('aria-pressed', String(b.dataset.sort === mistakeSort));
  }
  $('ms-window').value = mistakeWindow == null ? 'all' : String(mistakeWindow);
  if (!rows.length) {
    $('ms-list').innerHTML = `<p class="note">No mistakes ${span}.</p>`;
    return;
  }
  const pct = (x) => `${(x * 100).toFixed(x * 100 >= 10 ? 0 : 1)}%`;
  const when = (m) =>
    m.t ? new Date(m.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Earlier';
  $('ms-list').innerHTML = rows
    .map(
      (r, i) => `
      <li class="ms-row-wrap">
        <details class="ms-group" data-key="${r.key}" ${openGroups.has(r.key) ? 'open' : ''}>
          <summary class="ms-row">
            <span class="ms-rank">${i + 1}</span>
            <div class="ms-body">
              <div class="ms-title">${r.label}</div>
              <div class="ms-meta">Book play: <strong>${ACTION_NAMES[r.book]}</strong></div>
            </div>
            <div class="ms-times"><b>${r.count}</b><small>times</small></div>
            <div class="ms-cost">
              <div class="ms-impact">−${pct(r.perHand)}</div>
              <div class="ms-sub">${money(r.perHand * 100, false)} per $100 hand</div>
              <div class="ms-sub">${money(r.cost, false)} total</div>
            </div>
          </summary>
          <ul class="ms-entries">
            ${r.entries
              .map(
                (m) => `
              <li>
                <span>${when(m)}${m.hand ? ` · hand ${m.hand}` : ''}</span>
                <span>${money(m.stake, false)} bet · ${money(m.cost, false)}</span>
                <button type="button" class="ms-remove" data-id="${m.id}" aria-label="Remove this mistake">Remove</button>
              </li>`
              )
              .join('')}
          </ul>
          ${r.count > 1 ? `<button type="button" class="pill-btn ms-remove-all" data-key="${r.key}">Remove all ${r.count} (misclicks)</button>` : ''}
        </details>
      </li>`
    )
    .join('');

  $('ms-list').querySelectorAll('details').forEach((d) =>
    d.addEventListener('toggle', () => (d.open ? openGroups.add(d.dataset.key) : openGroups.delete(d.dataset.key)))
  );
  $('ms-list').querySelectorAll('.ms-remove').forEach((b) =>
    b.addEventListener('click', () => purgeMistakes([b.dataset.id]))
  );
  $('ms-list').querySelectorAll('.ms-remove-all').forEach((b) =>
    b.addEventListener('click', () => {
      const row = rows.find((r) => r.key === b.dataset.key);
      if (row && window.confirm(`Remove all ${row.count} "${row.label}" mistakes shown?`)) {
        purgeMistakes(row.entries.map((m) => m.id));
      }
    })
  );
}

$('mistakes-btn').addEventListener('click', () => {
  renderMistakeSummary();
  $('mistake-summary').showModal();
});
$('ms-close').addEventListener('click', () => $('mistake-summary').close());
document.querySelectorAll('[data-sort]').forEach((b) =>
  b.addEventListener('click', () => {
    mistakeSort = b.dataset.sort;
    renderMistakeSummary();
  })
);
$('ms-window').addEventListener('change', (e) => {
  mistakeWindow = e.target.value === 'all' ? null : Number(e.target.value);
  renderMistakeSummary();
});

const countTrainer = initCountTrainer({ dialog: $('count-trainer') });
$('learn-count-btn').addEventListener('click', () => countTrainer.open());

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
